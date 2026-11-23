"""Runtime adapter and stable input directory acceptance checks."""
from concurrent.futures import ThreadPoolExecutor
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'product-requirements/scripts'))
from build_documents import publish
from ingest_material import ingest
from intake_runner import IntakeRunner, transcribe
from workflow import Workflow, WorkflowConflict
from feishu_connector import ConnectorError


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.incoming = self.root / 'incoming'
        self.incoming.mkdir()
        self.workspace = self.root / 'workspace'
        self.run = self.root / 'v1'
        self.project = {'project_id': 'demo', 'schema_version': '0.1', 'artifact_version': 'v1', 'baseline_version': None,
                        'context_sources': [], 'requirement_profile': {}, 'requirements': [], 'business_model': {}, 'pages': [], 'design_context': {}}
        source = {'source_id': 'SRC-1', 'project_id': 'demo', 'text': '项目初始化元数据', 'source_type': 'project_metadata', 'locator': {'paragraph': 1}}
        publish(self.project, {'SRC-1': source}, self.run)

    def host_config(self, body=None):
        host = self.root / 'host.py'
        host.write_text(body or 'import sys,json\np=json.load(sys.stdin)\nr=p["baseline"]\nr["artifact_version"]=p["request"]["artifact_version"]\nr["baseline_version"]=p["request"]["baseline_version"]\nprint(json.dumps(r))\n')
        return {'argv': [sys.executable, str(host)], 'provider': 'test_adapter', 'model': 'fixture'}

    def test_stable_file_creates_analysis_request_and_does_not_repeat(self):
        (self.incoming / 'meeting.txt').write_text('需要查询项目。')
        runner = IntakeRunner(self.workspace, self.run, self.incoming, stable_seconds=2)
        with patch('intake_runner.time.time', return_value=10):
            self.assertEqual(runner.once(), [])
        with patch('intake_runner.time.time', return_value=13):
            results = runner.once()
        self.assertEqual(results[0]['task']['status'], 'waiting_host')
        self.assertEqual(runner.once(), [])
        self.assertEqual(len(Workflow(self.workspace).tasks('demo')), 1)

    def test_configured_host_produces_valid_version_and_idempotent_execution(self):
        workflow = Workflow(self.workspace)
        task = workflow.prepare(self.run, [], 'v2')
        result = workflow.execute(task['id'], self.host_config())
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['attempt'], 1)
        self.assertEqual(workflow.execute(task['id'], self.host_config())['attempt'], 1)

    def test_host_failure_keeps_task_and_explicit_retry(self):
        workflow = Workflow(self.workspace)
        task = workflow.prepare(self.run, [], 'v2')
        with self.assertRaisesRegex(ValueError, 'exited with code'):
            workflow.execute(task['id'], self.host_config('raise SystemExit(2)\n'))
        self.assertEqual(workflow.task(task['id'])['status'], 'failed')
        self.assertEqual(workflow.execute(task['id'], self.host_config())['status'], 'completed')

    def test_watcher_does_not_repeat_failed_paid_host_calls(self):
        (self.incoming / 'meeting.txt').write_text('需要查询项目。')
        config = self.host_config('raise SystemExit(2)\n')
        runner = IntakeRunner(self.workspace, self.run, self.incoming, stable_seconds=0, analysis_config=config)
        first = runner.once()
        self.assertIn('error', first[0])
        self.assertEqual(runner.once(), [])
        self.assertEqual(Workflow(self.workspace).tasks('demo')[0]['attempt'], 1)

    def test_watcher_can_use_configured_host(self):
        (self.incoming / 'meeting.txt').write_text('需要查询项目。')
        runner = IntakeRunner(self.workspace, self.run, self.incoming, stable_seconds=0, analysis_config=self.host_config())
        self.assertEqual(runner.once()[0]['task']['status'], 'completed')

    def test_asr_adapter_normalizes_and_links_transcript(self):
        recording = self.root / 'recording.mp4'
        recording.write_bytes(b'synthetic recording fixture')
        with patch('ingest_material.shutil.which', return_value=None):
            job = ingest(recording, self.workspace, 'demo')
        adapter = self.root / 'asr.py'
        adapter.write_text('import sys\nfrom pathlib import Path\nPath(sys.argv[2]).write_text("1\\n00:00:00,000 --> 00:00:01,000\\n合成适配器输出。\\n")\n')
        result = transcribe(self.workspace, job['job_id'], {'argv': [sys.executable, str(adapter), '{input}', '{output}'], 'model': 'fixture'})
        self.assertEqual(result['status'], 'ready_for_analysis')
        self.assertEqual(result['provenance']['related_job_id'], job['job_id'])
        self.assertEqual(result['provenance']['model'], 'fixture')

    def test_minutes_poll_is_query_scoped_and_deduplicated(self):
        file = self.incoming / 'transcript.srt'
        file.write_text('1\n00:00:00,000 --> 00:00:01,000\n会议需求。\n')
        job = ingest(file, self.workspace, 'demo')
        file.unlink()
        runner = IntakeRunner(self.workspace, self.run, self.incoming, minutes_query='明确项目名称')
        page = {'items': [{'token': 'obcn00000000000000000000'}], 'has_more': False}
        with patch('intake_runner.call_cli', return_value=page) as search, patch('intake_runner.import_minutes', return_value=job) as fetch:
            self.assertEqual(runner.once()[0]['task']['status'], 'waiting_host')
            runner.last_minutes_poll = None
            self.assertEqual(runner.once(), [])
            self.assertEqual(fetch.call_count, 1)
            arguments = search.call_args.args[0]
            self.assertIn('明确项目名称', arguments)
            self.assertIn('me', arguments)

    def test_unready_minutes_wait_without_premature_failure(self):
        runner = IntakeRunner(self.workspace, self.run, self.incoming, minutes_query='明确项目')
        page = {'items': [{'token': 'obcn00000000000000000000'}]}
        with patch('intake_runner.call_cli', return_value=page), patch('intake_runner.import_minutes', side_effect=ConnectorError('not ready', code=2091003)) as fetch:
            statuses = []
            for _ in range(4):
                runner.last_minutes_poll = None
                statuses.extend(item['status'] for item in runner.once())
            self.assertEqual(statuses, ['waiting_ready'] * 4)
            self.assertEqual(fetch.call_count, 4)

    def test_watcher_does_not_follow_out_of_scope_symlinks(self):
        outside = self.root / 'private.txt'
        outside.write_text('out of scope')
        (self.incoming / 'link.txt').symlink_to(outside)
        runner = IntakeRunner(self.workspace, self.run, self.incoming, stable_seconds=0)
        self.assertEqual(runner.once(), [])
