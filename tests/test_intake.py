"""Intake regressions for immutable inputs, connector paths and local review writes."""
from concurrent.futures import ThreadPoolExecutor
import http.client
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / 'product-requirements/scripts'
sys.path.insert(0, str(SCRIPTS))
import ingest_material as intake
import feishu_connector as connector
import serve_workbench as service
import build_documents as build


class IntakeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.workspace = self.root / 'inbox'
        self.file = self.root / 'meeting.txt'
        self.file.write_text('查询工单。\n\n统计口径待确认。', encoding='utf-8')

    def test_text_keeps_original_and_creates_traceable_sources(self):
        job = intake.ingest(self.file, self.workspace, 'demo')
        folder = self.workspace / 'jobs' / job['job_id']
        self.assertEqual(job['status'], 'ready_for_analysis')
        self.assertEqual(job['stage'], 'normalized')
        rows = [json.loads(line) for line in (folder / 'sources.jsonl').read_text().splitlines()]
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]['source_name'], 'meeting.txt')
        self.assertEqual(rows[0]['locator'], {'paragraph': 1})
        self.assertEqual((folder / 'original.txt').read_bytes(), self.file.read_bytes())
        self.assertFalse((folder / 'project.json').exists())

    def test_duplicate_concurrent_imports_publish_one_job(self):
        with ThreadPoolExecutor(max_workers=2) as executor:
            jobs = list(executor.map(lambda _: intake.ingest(self.file, self.workspace, 'demo'), range(2)))
        self.assertEqual(jobs[0]['job_id'], jobs[1]['job_id'])
        self.assertEqual(len(list((self.workspace / 'jobs').glob('JOB-*'))), 1)
        self.assertFalse(list((self.workspace / 'jobs').glob('.intake-*')))

    def test_same_content_in_other_project_has_separate_job(self):
        a = intake.ingest(self.file, self.workspace, 'a')
        b = intake.ingest(self.file, self.workspace, 'b')
        self.assertNotEqual(a['job_id'], b['job_id'])

    def test_invalid_subtitles_keep_failed_attempt_and_retry(self):
        self.file = self.root / 'bad.srt'
        self.file.write_text('Invalid timestamps')
        a = intake.ingest(self.file, self.workspace, 'demo')
        b = intake.ingest(self.file, self.workspace, 'demo', retry=True)
        self.assertEqual(a['status'], 'failed')
        self.assertEqual(b['retry_of'], a['job_id'])
        self.assertNotEqual(a['job_id'], b['job_id'])
        self.assertTrue((self.workspace / 'jobs' / a['job_id'] / 'original.srt').exists())

    def test_missing_ffmpeg_waits_for_transcript(self):
        file = self.root / 'meeting.mp4'
        file.write_bytes(b'media-placeholder')
        with patch.object(intake.shutil, 'which', return_value=None):
            job = intake.ingest(file, self.workspace, 'demo')
        self.assertEqual(job['status'], 'awaiting_transcript')
        self.assertNotIn('sources', job['files'])

    def test_transcript_can_link_only_to_same_project_recording(self):
        video = self.root / 'video.mp4'
        video.write_bytes(b'placeholder')
        with patch.object(intake.shutil, 'which', return_value=None):
            recording = intake.ingest(video, self.workspace, 'demo')
        transcript = intake.ingest(self.file, self.workspace, 'demo', related_job_id=recording['job_id'])
        self.assertEqual(transcript['provenance']['related_job_id'], recording['job_id'])
        with self.assertRaisesRegex(ValueError, 'this project'):
            intake.ingest(self.file, self.workspace, 'other', related_job_id=recording['job_id'])

    def test_connector_rejects_other_urls(self):
        for value in ['https://evil.test/minutes/obcn00000000000000000000', 'https://sample.feishu.cn/docx/abc', '--output', 'https://sample.feishu.cn.evil.test/minutes/obcn00000000000000000000']:
            with self.assertRaises(connector.ConnectorError):
                connector.minute_token(value)

    def test_connector_imports_only_selected_transcript(self):
        token = 'obcn00000000000000000000'
        def fake_call(arguments, cwd=None):
            output = Path(cwd) / arguments[arguments.index('--output') + 1]
            self.assertFalse(Path(arguments[arguments.index('--output') + 1]).is_absolute())
            output.write_text('1\n00:00:00,000 --> 00:00:02,000\n客户需要查询工单。\n')
            self.assertEqual(arguments[:2], ['api', 'GET'])
            self.assertTrue(arguments[2].endswith('/transcript'))
            return {'saved_path': str(output)}
        with patch.object(connector, 'call_cli', side_effect=fake_call):
            job = connector.import_minutes('https://sample.feishu.cn/minutes/' + token, self.workspace, 'demo')
        self.assertEqual(job['provenance']['minute_token'], token)
        self.assertEqual(job['status'], 'ready_for_analysis')

    def test_connector_rejects_returned_file_outside_download(self):
        token = 'obcn00000000000000000000'
        with patch.object(connector, 'call_cli', return_value={'minute_token': token, 'saved_path': str(self.file)}):
            with self.assertRaisesRegex(connector.ConnectorError, 'outside'):
                connector.import_minutes(token, self.workspace, 'demo', media=True)

    def test_connector_reads_safety_error_after_download_progress(self):
        result = subprocess.CompletedProcess([], 2, '', 'Downloading media: sample\n' + json.dumps({'ok': False, 'error': {'message': 'blocked download URL: local/internal host is not allowed'}}))
        with patch.object(connector.subprocess, 'run', return_value=result):
            with self.assertRaisesRegex(connector.ConnectorError, 'URL safety checks'):
                connector.call_cli([])

    def test_connector_error_contains_scope_and_omits_private_response(self):
        result = subprocess.CompletedProcess([], 3, '', json.dumps({'ok': False, 'error': {'missing_scopes': ['minutes:minutes.media:export'], 'hint': 'private URL'}}))
        with patch.object(connector.subprocess, 'run', return_value=result):
            with self.assertRaisesRegex(connector.ConnectorError, 'minutes:minutes.media:export') as error:
                connector.call_cli([])
        self.assertNotIn('private URL', str(error.exception))


class LocalServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = {'project_id': 'demo', 'schema_version': '0.1', 'artifact_version': 'v1', 'baseline_version': None,
                        'context_sources': [], 'requirement_profile': {}, 'requirements': [{'requirement_id': 'REQ-001', 'title': '查询', 'source_refs': ['SRC-1'], 'evidence_type': 'explicit', 'review_status': 'draft'}], 'business_model': {}, 'pages': [], 'design_context': {}}
        self.source = {'source_id': 'SRC-1', 'project_id': 'demo', 'text': '查询', 'locator': {'paragraph': 1}}
        self.run = self.root / 'run'
        build.publish(self.project, {'SRC-1': self.source}, self.run)
        self.server = service.WorkbenchServer(('127.0.0.1', 0), self.run, self.root / 'inbox')
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.close_server)

    def close_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_address[1], timeout=10)
        connection.request(method, path, body, headers or {})
        result = connection.getresponse()
        data = result.read()
        status = result.status
        connection.close()
        return status, data

    def test_document_endpoint_saves_a_scoped_immutable_version(self):
        sha = hashlib.sha256((self.run / 'proposal.md').read_bytes()).hexdigest()
        payload = {'document': 'proposal.md', 'content': '# 已修订方案\n', 'version': 'v2', 'base_sha256': sha}
        status, raw = self.request('POST', '/api/documents', json.dumps(payload), {'X-Workbench-Request': '1'})
        self.assertEqual(status, 201, raw)
        task = json.loads(raw)['task']
        self.assertEqual(task['kind'], 'document')
        status, content = self.request('GET', '/versions/' + task['id'] + '/proposal.md')
        self.assertEqual(status, 200)
        self.assertEqual(content.decode(), payload['content'])
        status, raw = self.request('POST', '/api/documents', json.dumps({**payload, 'version': 'v3', 'base_sha256': 'stale'}), {'X-Workbench-Request': '1'})
        self.assertEqual(status, 409)

    def test_upload_is_preprocessed_and_can_be_read_by_artifact_key(self):
        status, raw = self.request('POST', '/api/import?filename=meeting.txt', 'text', {'X-Workbench-Request': '1'})
        self.assertEqual(status, 201)
        job = json.loads(raw)['job']
        status, raw = self.request('GET', '/api/jobs/' + job['job_id'] + '/sources')
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)['text'], 'text')
        self.assertEqual(self.request('GET', '/api/jobs/' + job['job_id'] + '/../../project.json')[0], 404)

    def test_mutation_requires_local_request_header_and_same_origin(self):
        self.assertEqual(self.request('POST', '/api/import?filename=x.txt', 'x')[0], 403)
        self.assertEqual(self.request('POST', '/api/import?filename=x.txt', 'x', {'X-Workbench-Request': '1', 'Origin': 'https://evil.test'})[0], 403)
        self.assertEqual(self.request('GET', '/api/status', headers={'Host': 'evil.test'})[0], 403)

    def test_upload_cannot_escape_workspace(self):
        status, _ = self.request('POST', '/api/import?filename=..%2Fevil.txt', 'x', {'X-Workbench-Request': '1'})
        self.assertEqual(status, 400)
        self.assertFalse((self.root / 'evil.txt').exists())

    def test_review_revision_prevents_lost_update_and_preserves_baseline(self):
        payload = {'revision': 0, 'target': 'REQ-001', 'outcome': 'confirmed', 'comment': '核对范围'}
        status, raw = self.request('POST', '/api/review', json.dumps(payload), {'X-Workbench-Request': '1'})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)['review']['revision'], 1)
        self.assertEqual(self.request('POST', '/api/review', json.dumps(payload), {'X-Workbench-Request': '1'})[0], 409)
        self.assertEqual(json.loads((self.run / 'project.json').read_text()), self.project)
        self.assertEqual(len(self.server.review()['decisions']), 1)

    def test_analysis_api_and_new_version_scoped_review(self):
        headers = {'X-Workbench-Request': '1'}
        status, raw = self.request('POST', '/api/analysis', json.dumps({'version': 'v2', 'job_ids': []}), headers)
        self.assertEqual(status, 201)
        task = json.loads(raw)['task']
        self.assertEqual(self.request('GET', '/api/tasks/' + task['id'] + '/request')[0], 200)
        candidate = json.loads(json.dumps(self.project))
        candidate.update(artifact_version='v2', baseline_version='v1')
        status, raw = self.request('POST', '/api/analysis/complete', json.dumps({'request_id': task['id'], 'project': candidate}), headers)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)['task']['status'], 'completed')
        self.assertEqual(self.request('GET', '/versions/' + task['id'] + '/workbench/index.html')[0], 200)
        status, raw = self.request('GET', '/api/status', headers={'X-Workbench-Run': task['id']})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)['artifact_version'], 'v2')
        review = {'revision': 0, 'target': 'REQ-001', 'outcome': 'confirmed'}
        status, _ = self.request('POST', '/api/review', json.dumps(review), {**headers, 'X-Workbench-Run': task['id']})
        self.assertEqual(status, 200)
        self.assertEqual(len(self.server.review(candidate)['decisions']), 1)
        self.assertEqual(self.server.review()['decisions'], [])

    def test_review_api_application_requires_current_revision(self):
        headers = {'X-Workbench-Request': '1'}
        review = {'revision': 0, 'target': 'REQ-001', 'outcome': 'confirmed'}
        self.request('POST', '/api/review', json.dumps(review), headers)
        self.assertEqual(self.request('POST', '/api/review/apply', json.dumps({'revision': 0, 'version': 'v2'}), headers)[0], 409)
        status, raw = self.request('POST', '/api/review/apply', json.dumps({'revision': 1, 'version': 'v2'}), headers)
        self.assertEqual(status, 201)
        result = json.loads(raw)['task']
        project = json.loads((Path(result['result_dir']) / 'project.json').read_text())
        self.assertEqual(project['requirements'][0]['review_status'], 'confirmed')

    def test_static_files_allow_only_manifest_entries_and_byte_ranges(self):
        self.assertEqual(self.request('GET', '/workbench/index.html')[0], 200)
        self.assertEqual(self.request('GET', '/../../reviews.sqlite3')[0], 404)
        self.assertEqual(self.request('GET', '/')[0], 200)
        status, raw = self.request('GET', '/project.json', headers={'Range': 'bytes=0-9'})
        self.assertEqual(status, 206)
        self.assertEqual(len(raw), 10)
