"""Synthetic acceptance flow from intake through review, artifacts, release and feedback."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'product-requirements/scripts'))
from ingest_material import ingest
from release_package import build_release
from workflow import Workflow, initialize
from generate_artifacts import resolve


def host_project(request, baseline, sources):
    """Explicit fixture response, not a semantic extraction implementation."""
    project = copy.deepcopy(baseline)
    project.update(artifact_version=request['artifact_version'], baseline_version=request['baseline_version'])
    transcript = [source for source in sources if source.get('source_type') == 'transcript']
    ids = [source['source_id'] for source in transcript]
    project['requirement_profile'] = {'customer_and_roles': '客服', 'business_scenario': '工单创建和查询', 'pain_points': None,
                                      'desired_outcomes': '登记售后问题并按主题找到工单', 'scope': ['创建工单', '主题查询'], 'constraints': None,
                                      'integrations': None, 'evidence_and_questions': '预算与上线日期待确认'}
    project['requirements'] = [
        {'requirement_id': 'REQ-001', 'title': '创建工单', 'role': '客服', 'trigger': '填写工单表单', 'behavior': '填写主题后创建工单',
         'inputs': ['主题'], 'outputs': ['工单编号'], 'rules': ['主题必填'], 'exceptions': ['缺少主题时提示'], 'acceptance_criteria': '主题必填，提交后显示编号',
         'source_refs': [ids[0]], 'evidence_type': 'explicit', 'review_status': 'draft', 'locked_fields': ['acceptance_criteria']},
        {'requirement_id': 'REQ-002', 'title': '查询工单', 'role': '客服', 'trigger': '查看工单列表', 'behavior': '按主题关键字查找工单',
         'inputs': ['关键字'], 'outputs': ['匹配工单'], 'rules': None, 'exceptions': None, 'acceptance_criteria': '输入主题关键字能看到已创建的工单',
         'source_refs': [ids[1]], 'evidence_type': 'explicit', 'review_status': 'draft', 'locked_fields': []}]
    project['modules'] = [{'module_id': 'tickets', 'name': '工单', 'requirement_ids': ['REQ-001', 'REQ-002']}]
    project['business_model'] = {'status': 'draft', 'entities': [{'name': 'Ticket', 'source_refs': [ids[0]], 'fields': [{'name': 'record_id', 'type': 'string'}, {'name': 'subject', 'type': 'string'}]}],
                                  'relations': [], 'flows': [{'id': 'ticket-flow', 'name': '工单流程', 'steps': [{'id': 'create', 'label': '填写工单', 'requirement_ids': ['REQ-001']}, {'id': 'result', 'label': '查看编号', 'requirement_ids': ['REQ-001']}, {'id': 'search', 'label': '查询工单', 'requirement_ids': ['REQ-002']}]}]}
    project['pages'] = [
        {'page_id': 'create', 'name': '创建工单', 'requirement_ids': ['REQ-001'], 'fields': [{'id': 'subject', 'label': '主题', 'required': True}],
         'actions': [{'id': 'save', 'type': 'submit', 'label': '创建工单', 'success_message': '工单已创建'}, {'id': 'list', 'type': 'navigate', 'label': '查看列表', 'target_page_id': 'list'}],
         'columns': [{'id': 'record_id', 'label': '示例编号'}, {'id': 'subject', 'label': '主题'}]},
        {'page_id': 'list', 'name': '工单列表', 'requirement_ids': ['REQ-002'], 'records_from': 'create',
         'columns': [{'id': 'record_id', 'label': '示例编号'}, {'id': 'subject', 'label': '主题'}],
         'actions': [{'id': 'create', 'type': 'navigate', 'label': '新建工单', 'target_page_id': 'create'}]}]
    project['business_model']['flows'].append({'id': 'search-flow', 'name': '查询工单', 'steps': [
        {'id': 'query', 'label': '输入主题关键字', 'requirement_ids': ['REQ-002']},
        {'id': 'matches', 'label': '查看匹配工单', 'requirement_ids': ['REQ-002']}]})
    return project


def exercise(root):
    workspace = root / 'workspace'
    baseline = root / 'v0'
    initialize('demo', '合成验收 · 售后工单', baseline)
    workflow = Workflow(workspace)
    fixture = Path(__file__).parent / 'fixtures/customer-meeting.txt'
    job = ingest(fixture, workspace, 'demo')
    task = workflow.prepare(baseline, [job['job_id']], 'v1')
    folder = Path(task['request_path']).parent
    request = json.loads(Path(task['request_path']).read_text())
    sources = [json.loads(line) for line in (folder / 'sources.jsonl').read_text().splitlines()]
    response = host_project(request, json.loads((folder / 'baseline.json').read_text()), sources)
    v1 = Path(workflow.complete(task['id'], response)['result_dir'])
    notes = {'project_id': 'demo', 'artifact_version': 'v1', 'review_stage': 'definition', 'decisions': [
        {'decision_id': 'DEFINE-' + key, 'target': key, 'outcome': 'confirmed', 'artifact_version': 'v1', 'review_stage': 'definition', 'reviewer': '合成验收角色'} for key in ['REQ-001', 'REQ-002']]}
    v2 = Path(workflow.apply_review(v1, notes, 'v2')['result_dir'])
    generation = workflow.generate(v2, 'v3', ['workflow', 'erd', 'prototype'])
    v3 = Path(generation['result_dir'])
    release_notes = {'project_id': 'demo', 'artifact_version': 'v3', 'decisions': [{'decision_id': 'RELEASE-1', 'target': 'prototype/index.html', 'outcome': 'confirmed', 'artifact_version': 'v3', 'review_stage': 'release', 'reviewer': '合成验收角色'}]}
    release = build_release(v3, workspace, ['prototype/index.html'], release_notes)
    feedback = root / 'feedback.txt'
    feedback.write_text('【合成第二次会议】希望放宽主题必填要求，并增加 CSV 导出，导出字段待商量。')
    next_job = ingest(feedback, workspace, 'demo')
    next_task = workflow.prepare(v3, [next_job['job_id']], 'v4')
    next_candidate = json.loads((v3 / 'project.json').read_text())
    next_candidate.update(artifact_version='v4', baseline_version='v3')
    next_candidate['requirements'][0]['acceptance_criteria'] = '主题可以为空'
    v4 = Path(workflow.complete(next_task['id'], next_candidate)['result_dir'])
    return {'workspace': workspace, 'v1': v1, 'v2': v2, 'v3': v3, 'v4': v4, 'generation': generation, 'release': release}


class EndToEndTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        for capability in ['archify', 'schema-canvas']:
            try:
                resolve(capability)
            except ValueError as error:
                raise unittest.SkipTest(str(error)) from error

    def test_intake_review_generation_release_and_locked_feedback(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = exercise(Path(temporary))
            self.assertTrue((result['v3'] / 'prototype/index.html').is_file())
            self.assertTrue((result['v3'] / 'data-model/index.html').is_file())
            self.assertTrue((result['v3'] / 'diagrams/workflow.html').is_file())
            self.assertTrue((result['v3'] / 'diagrams/workflow-2.html').is_file())
            self.assertTrue(all(item['generation_status'] == 'success' for item in result['generation']['generation_results']))
            self.assertTrue(json.loads((result['v2'] / 'project.json').read_text())['requirements'][0]['review_status'] == 'confirmed')
            diff = json.loads((result['v4'] / 'diff.json').read_text())
            self.assertEqual(diff['conflicts'][0]['field'], 'acceptance_criteria')
            self.assertEqual(json.loads((result['v4'] / 'project.json').read_text())['requirements'][0]['acceptance_criteria'], '主题必填，提交后显示编号')
            archive = result['workspace'] / 'releases' / result['release']['release_id'] / 'package.zip'
            with zipfile.ZipFile(archive) as package:
                self.assertNotIn('sources.jsonl', package.namelist())
                self.assertNotIn('prd.md', package.namelist())
                self.assertNotIn('review-notes.json', package.namelist())
            self.assertTrue((archive.parent / 'review-notes.json').is_file())
            self.assertFalse((result['v4'] / 'prototype/index.html').exists())
            # New material keeps the diagrams the previous version had; the prototype waits for review.
            carried = [item['capability'] for item in json.loads((result['v4'] / 'generation.json').read_text())['results'] if item['generation_status'] == 'success']
            self.assertNotIn('prototype', carried)
            self.assertTrue(set(carried) >= {'workflow'})
