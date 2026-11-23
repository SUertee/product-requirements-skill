"""Customer comments from the prototype's feedback form become traceable materials."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'product-requirements/scripts'))
import feishu_connector as feedback
from customer_review import read_feedback


def row(record_id, comment, version='v3', project='demo', page='工单列表', requirements='REQ-001 REQ-002', name='', place='工单列表 › 状态（表头）'):
    return {'record_id': record_id, '意见': comment, '页面': page, '位置': place, '需求': requirements, '原型版本': version, '项目': project, '称呼': name}


class PrototypeFeedbackTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.workspace = Path(self.temp.name) / 'inbox'

    def jobs(self):
        return [json.loads(file.read_text()) for file in sorted((self.workspace / 'jobs').glob('JOB-*/job.json'))]

    def test_new_comments_become_one_material_per_version_and_are_not_imported_twice(self):
        rows = [row('rec1', '筛选应该默认显示未解决', name='客服主管'), row('rec2', '新建页缺少来电号码', version='v4', requirements='REQ-001'),
                row('rec3', '别的项目', project='other'), row('rec4', '')]
        result = feedback.import_feedback('baseToken0001', 'tblTable0001', self.workspace, 'demo', rows)
        self.assertEqual([(job['artifact_version'], job['comments']) for job in result['jobs']], [('v3', 1), ('v4', 1)])
        self.assertEqual(result['skipped_other_projects'], 1)
        jobs = {job['provenance']['artifact_version']: job for job in self.jobs()}
        self.assertEqual(jobs['v3']['provenance']['provider'], 'prototype_feedback')
        self.assertEqual(jobs['v3']['status'], 'ready_for_analysis')
        answers = read_feedback(self.workspace, jobs['v3'])['answers']
        self.assertEqual([answer['target'] for answer in answers], ['REQ-001', 'REQ-002'])
        self.assertEqual(answers[0]['answer'], '筛选应该默认显示未解决')
        self.assertEqual(answers[0]['respondent'], '客服主管')
        original = (self.workspace / 'jobs' / jobs['v3']['job_id'] / 'original.txt').read_text()
        self.assertIn('客户意见：筛选应该默认显示未解决', original)
        self.assertIn('位置：工单列表 › 状态（表头）', original)
        self.assertEqual(answers[0]['prompt'], '原型「工单列表 › 状态（表头）」')
        again = feedback.import_feedback('baseToken0001', 'tblTable0001', self.workspace, 'demo', rows + [row('rec5', '导出放二期')])
        self.assertEqual([job['comments'] for job in again['jobs']], [1])
        self.assertEqual(len(self.jobs()), 3)

    def test_records_are_read_page_by_page_through_lark_cli(self):
        pages = [{'fields': ['意见', '项目'], 'record_id_list': ['rec1'], 'data': [['好用', 'demo']], 'has_more': True},
                 {'fields': ['意见', '项目'], 'record_id_list': ['rec2'], 'data': [[[{'text': '太慢'}], 'demo']], 'has_more': False}]
        calls = []
        def fake(arguments, cwd=None):
            calls.append(arguments)
            return pages[len(calls) - 1]
        with patch.object(feedback, 'call_cli', side_effect=fake):
            rows = feedback.fetch_feedback('baseToken0001', 'tblTable0001')
        self.assertEqual([item['意见'] for item in rows], ['好用', '太慢'])
        self.assertEqual(calls[1][calls[1].index('--offset') + 1], '1')

    def test_tokens_are_checked_before_calling_feishu(self):
        with self.assertRaises(ValueError):
            feedback.import_feedback('../x', 'tblTable0001', self.workspace, 'demo', [])


if __name__ == '__main__':
    unittest.main()
