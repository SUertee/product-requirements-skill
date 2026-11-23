import json
from pathlib import Path
import re
import sys
import tempfile
from threading import Thread
import unittest
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'product-requirements' / 'scripts'))
from customer_review import CustomerReviewServer, read_feedback, validate_questions
from serve_workbench import WorkbenchServer
from workflow import initialize


class CustomerReviewTests(unittest.TestCase):
    def test_questions_must_reference_current_requirements(self):
        with self.assertRaisesRegex(ValueError, '关联当前版本'):
            validate_questions({'requirements': []}, [{'target': 'REQ-001'}])

    def test_customer_answer_reaches_versioned_inbox(self):
        with tempfile.TemporaryDirectory() as temporary:
            workspace = Path(temporary)
            with CustomerReviewServer(('127.0.0.1', 0), workspace) as server:
                thread = Thread(target=server.serve_forever)
                thread.start()
                try:
                    url = server.publish({
                        'project_id': 'demo', 'artifact_version': 'v3',
                        'requirements': [{'requirement_id': 'REQ-001'}],
                        'internal_notes': 'PRIVATE',
                    }, [{'target': 'REQ-001', 'prompt': '电话必填吗？<script>',
                         'options': ['必填', '选填']}])
                    with urlopen(url, timeout=5) as response:
                        html = response.read().decode()
                    self.assertIn('&lt;script&gt;', html)
                    self.assertNotIn('PRIVATE', html)
                    with self.assertRaises(HTTPError) as denied:
                        urlopen(url.split('/review/')[0] + '/workbench/index.html', timeout=5)
                    self.assertEqual(denied.exception.code, 404)
                    submission = re.search(r'name="submission" value="([^"]+)"', html)[1]
                    form = {'submission': submission, 'respondent': '客服主管', 'answer-0': '2'}
                    with self.assertRaises(HTTPError) as invalid:
                        urlopen(Request(url, data=urlencode(form).encode()), timeout=5)
                    self.assertEqual(invalid.exception.code, 400)
                    form['note-0'] = '有回访需求时才必填'
                    request = Request(url, data=urlencode(form).encode())
                    for _ in range(2):
                        with urlopen(request, timeout=5) as response:
                            self.assertIn('反馈已提交', response.read().decode())
                    files = list((workspace / 'jobs').glob('*/job.json'))
                    self.assertEqual(len(files), 1)
                    job = json.loads(files[0].read_text())
                    self.assertEqual(job['status'], 'ready_for_analysis')
                    self.assertEqual(job['provenance']['artifact_version'], 'v3')
                    self.assertIn('有回访需求时才必填', (files[0].parent / job['files']['sources']).read_text())
                    expected = {'respondent': '客服主管', 'answers': [
                        {'target': 'REQ-001', 'prompt': '电话必填吗？<script>',
                         'answer': '都不合适，我来补充', 'note': '有回访需求时才必填'},
                    ]}
                    self.assertEqual(read_feedback(workspace, job), expected)
                    del job['metadata']
                    self.assertEqual(read_feedback(workspace, job), expected)
                finally:
                    server.shutdown()
                    thread.join(timeout=5)

            run = workspace / 'v0'
            initialize('demo', '客户复核测试', run)
            with WorkbenchServer(('127.0.0.1', 0), run, workspace) as workbench:
                thread = Thread(target=workbench.serve_forever)
                thread.start()
                try:
                    original = f'http://127.0.0.1:{workbench.server_port}/api/jobs/{job["job_id"]}/original'
                    with urlopen(original, timeout=5) as response:
                        self.assertEqual(response.headers.get_content_charset(), 'utf-8')
                        self.assertIn('有回访需求时才必填', response.read().decode('utf-8'))
                finally:
                    workbench.shutdown()
                    thread.join(timeout=5)
