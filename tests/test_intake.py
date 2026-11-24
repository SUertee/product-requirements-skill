"""Intake regressions for immutable inputs, connector paths and local review writes."""
from concurrent.futures import ThreadPoolExecutor
import http.client
import hashlib
import io
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

    def test_meeting_speakers_are_recorded_and_text_kept_verbatim(self):
        subtitle = self.root / 'minutes.srt'
        cues = ['徐泽华: 对，我发出来那个', '说话人 2：先看工单列表', '徐泽华:', 'Speaker 1: export later', '徐嘉成: 注意：这里要脱敏']
        subtitle.write_text('\n\n'.join(f'{i}\n00:00:0{i},000 --> 00:00:0{i},900\n{text}' for i, text in enumerate(cues, 1)), encoding='utf-8')
        job = intake.ingest(subtitle, self.workspace, 'demo')
        rows = [json.loads(line) for line in (self.workspace / 'jobs' / job['job_id'] / 'sources.jsonl').read_text().splitlines()]
        self.assertEqual([row['speaker'] for row in rows], ['徐泽华', '说话人 2', None, 'Speaker 1', '徐嘉成'])
        self.assertEqual([row['text'] for row in rows], cues)

    def test_occasional_label_in_a_document_is_not_a_speaker(self):
        self.file.write_text('注意：统计口径待确认。\n\n客户需要按状态查询工单。\n\n导出功能放到二期。', encoding='utf-8')
        job = intake.ingest(self.file, self.workspace, 'demo')
        rows = [json.loads(line) for line in (self.workspace / 'jobs' / job['job_id'] / 'sources.jsonl').read_text().splitlines()]
        self.assertEqual({row['speaker'] for row in rows}, {None})

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

    def _blocked_then(self, link, body=b'\0' * 2048, headers=None, final=None):
        """call_cli: the normal download is blocked, --url-only returns the given link; urlopen serves body."""
        token = 'obcn00000000000000000000'
        def fake_call(arguments, cwd=None):
            if '--url-only' in arguments:
                return {'ok': True, 'data': {'downloads': [{'minute_token': token, 'download_url': link}]}}
            raise connector.BlockedDownload('Media download blocked by lark-cli URL safety checks for a local/internal host.')
        class Response:
            def __init__(self):
                self.headers = {'Content-Length': str(len(body)), 'Content-Type': 'video/mp4', **(headers or {})}
                self._data = io.BytesIO(body)
            def geturl(self): return final or link
            def read(self, size=-1): return self._data.read(size)
            def __enter__(self): return self
            def __exit__(self, *args): return False
        return token, fake_call, Response

    def test_blocked_media_download_falls_back_to_the_official_link(self):
        import urllib.request
        token, fake_call, Response = self._blocked_then('https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/authcode/?code=x',
                                                        headers={'Content-Disposition': 'attachment; filename="%E4%BC%9A%E8%AE%AE.mp4"'})
        seen = []
        with patch.object(connector, 'call_cli', side_effect=fake_call), \
                patch.object(urllib.request, 'urlopen', side_effect=lambda request, timeout=60: seen.append(request.full_url) or Response()), \
                patch('ingest_material.shutil.which', return_value=None):
            job = connector.import_minutes(token, self.workspace, 'demo', media=True)
        self.assertEqual(job['kind'], 'recording')
        self.assertEqual(job['name'], '会议.mp4')
        self.assertEqual(job['provenance']['artifact'], 'media')
        self.assertEqual(len(seen), 1)

    def test_fallback_only_downloads_from_feishu_https(self):
        import urllib.request
        for link, final in [('https://evil.test/a.mp4', None), ('http://internal-api-drive-stream.feishu.cn/a', None),
                            ('https://x.feishu.cn.evil.test/a', None), ('https://internal-api-drive-stream.feishu.cn/a', 'https://evil.test/a')]:
            token, fake_call, Response = self._blocked_then(link, final=final)
            with self.subTest(link=link, final=final), patch.object(connector, 'call_cli', side_effect=fake_call), \
                    patch.object(urllib.request, 'urlopen', side_effect=lambda request, timeout=60: Response()):
                with self.assertRaises(connector.ConnectorError):
                    connector.import_minutes(token, self.workspace, 'demo', media=True)

    def test_fallback_rejects_incomplete_download(self):
        import urllib.request
        token, fake_call, Response = self._blocked_then('https://internal-api-drive-stream.feishu.cn/a', headers={'Content-Length': '999999'})
        with patch.object(connector, 'call_cli', side_effect=fake_call), patch.object(urllib.request, 'urlopen', side_effect=lambda request, timeout=60: Response()):
            with self.assertRaisesRegex(connector.ConnectorError, 'incomplete'):
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

    def test_connector_check_reports_missing_cli_with_fallback(self):
        with patch.object(connector.shutil, 'which', return_value=None):
            result = connector.check()
        self.assertEqual(result['status'], 'not_ready')
        self.assertIn('fix', result['checks'][0])
        self.assertIn('transcript', result['fallback'])

    def test_connector_check_separates_required_and_optional_scopes(self):
        answers = {'status': {'identities': {'user': {'available': True, 'message': 'ready'}}},
                   'check': {'granted': connector.TRANSCRIPT_SCOPES}}
        with patch.object(connector.shutil, 'which', return_value='/usr/bin/lark-cli'), \
             patch.object(connector, '_json_command', side_effect=lambda arguments: answers[arguments[1]]):
            result = connector.check()
        self.assertEqual(result['status'], 'ready')
        missing = [item for item in result['checks'] if not item['ok']]
        self.assertEqual({item['name'] for item in missing}, set(connector.OPTIONAL_SCOPES))
        self.assertTrue(all(not item['required'] and 'auth login' in item['fix'] for item in missing))
        answers['check'] = {'granted': ['minutes:minutes.basic:read']}
        with patch.object(connector.shutil, 'which', return_value='/usr/bin/lark-cli'), \
             patch.object(connector, '_json_command', side_effect=lambda arguments: answers[arguments[1]]):
            self.assertEqual(connector.check()['status'], 'not_ready')


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

    def test_non_functional_requirement_can_be_reviewed(self):
        project = json.loads((self.run / 'project.json').read_text())
        project['nfrs'] = [{'nfr_id': 'NFR-001', 'category': 'performance', 'title': '列表分页', 'statement': '超过 50 条分页', 'review_status': 'draft'}]
        (self.run / 'project.json').write_text(json.dumps(project, ensure_ascii=False))
        payload = {'revision': 0, 'target': 'NFR-001', 'outcome': 'confirmed', 'comment': ''}
        self.assertEqual(self.request('POST', '/api/review', json.dumps(payload), {'X-Workbench-Request': '1'})[0], 200)
        self.assertEqual(self.server.review()['decisions'][-1]['target'], 'NFR-001')

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
