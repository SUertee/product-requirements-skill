"""Acceptance regressions for source-to-version tasks and version-bound review."""
import copy
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'product-requirements/scripts'))
import build_documents as build
from ingest_material import ingest
from project_revision import apply_review, digest
from workflow import Workflow, WorkflowConflict


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.run = self.root / 'v1'
        self.workspace = self.root / 'workspace'
        self.project = {'project_id': 'demo', 'schema_version': '0.1', 'artifact_version': 'v1', 'baseline_version': None,
                        'context_sources': [], 'requirement_profile': {}, 'business_model': {}, 'pages': [], 'design_context': {},
                        'requirements': [{'requirement_id': 'REQ-001', 'title': '工单查询', 'role': '客服', 'trigger': '打开列表', 'behavior': '筛选工单', 'acceptance_criteria': '显示符合筛选的工单', 'source_refs': ['SRC-001'], 'evidence_type': 'explicit', 'review_status': 'draft', 'locked_fields': ['behavior']}]}
        self.source = {'source_id': 'SRC-001', 'project_id': 'demo', 'text': '客服可以筛选工单。', 'locator': {'paragraph': 1}}
        build.publish(self.project, {'SRC-001': self.source}, self.run)
        self.workflow = Workflow(self.workspace)
        self.input = self.root / 'feedback.srt'
        self.input.write_text('1\n00:00:00,000 --> 00:00:02,000\n主管还需要周报。\n')
        self.job = ingest(self.input, self.workspace, 'demo')

    def candidate(self, version='v2'):
        candidate = copy.deepcopy(self.project)
        candidate.update(artifact_version=version, baseline_version='v1')
        return candidate

    def notes(self, outcome='confirmed'):
        return {'project_id': 'demo', 'artifact_version': 'v1', 'review_stage': 'definition',
                'decisions': [{'decision_id': 'D1', 'target': 'REQ-001', 'outcome': outcome, 'artifact_version': 'v1'}]}

    def test_analysis_publishes_documents_and_source_snapshot(self):
        task = self.workflow.prepare(self.run, [self.job['job_id']], 'v2')
        request = json.loads(Path(task['request_path']).read_text())
        self.assertEqual(request['source_count'], 2)
        result = self.workflow.complete(task['id'], self.candidate())
        output = Path(result['result_dir'])
        self.assertEqual(result['status'], 'completed')
        self.assertTrue((output / 'workbench/index.html').is_file())
        material = json.loads((output / 'project.json').read_text())['materials'][0]
        self.assertEqual((output / 'materials' / material['path']).read_bytes(), self.input.read_bytes())
        self.assertEqual(json.loads((self.run / 'project.json').read_text()), self.project)
        self.assertTrue((output / 'diff.json').is_file())
        self.assertEqual(result['job_ids'], [self.job['job_id']])

    def test_explicit_unlock_allows_edit_and_preserves_manual_evidence(self):
        changes = [{'target': 'REQ-001', 'field': 'behavior', 'value': '按主题筛选工单'},
                   {'target': 'REQ-001', 'field': 'locked_fields', 'value': []}]
        result = self.workflow.apply_review(self.run, self.notes(), 'v2', changes)
        output = Path(result['result_dir'])
        actual = json.loads((output / 'project.json').read_text())
        requirement = actual['requirements'][0]
        self.assertEqual(requirement['behavior'], '按主题筛选工单')
        self.assertEqual(requirement['locked_fields'], [])
        self.assertEqual(requirement['review_status'], 'draft')
        sources = [json.loads(line) for line in (output / 'sources.jsonl').read_text().splitlines()]
        manual = [source for source in sources if source.get('source_type') == 'manual_review']
        self.assertEqual(len(manual), 2)
        self.assertTrue(all(source['source_id'] in requirement['source_refs'] for source in manual))
        self.assertEqual(json.loads((output / 'diff.json').read_text())['conflicts'], [])
        self.assertEqual(json.loads((self.run / 'project.json').read_text()), self.project)

    def test_locked_edit_retains_value_and_proposed_manual_evidence(self):
        changes = [{'target': 'REQ-001', 'field': 'behavior', 'value': '删除全部工单'}]
        result = self.workflow.apply_review(self.run, self.notes(), 'v2', changes)
        output = Path(result['result_dir'])
        actual = json.loads((output / 'project.json').read_text())
        self.assertEqual(actual['requirements'][0]['behavior'], '筛选工单')
        self.assertEqual(actual['requirements'][0]['source_refs'], ['SRC-001'])
        self.assertEqual(json.loads((output / 'diff.json').read_text())['conflicts'][0]['proposed'], '删除全部工单')
        sources = [json.loads(line) for line in (output / 'sources.jsonl').read_text().splitlines()]
        self.assertTrue(any(source.get('source_type') == 'manual_review' for source in sources))

    def test_duplicate_prepare_and_complete_are_idempotent(self):
        a = self.workflow.prepare(self.run, [self.job['job_id']], 'v2')
        b = self.workflow.prepare(self.run, [self.job['job_id'], self.job['job_id']], 'v2')
        self.assertEqual(a['id'], b['id'])
        self.workflow.complete(a['id'], self.candidate())
        result = self.workflow.complete(a['id'], self.candidate())
        self.assertEqual(result['attempt'], 1)

    def test_concurrent_prepare_reserves_one_task(self):
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: self.workflow.prepare(self.run, [self.job['job_id']], 'v2'), range(2)))
        self.assertEqual(results[0]['id'], results[1]['id'])
        self.assertEqual(len(self.workflow.tasks('demo')), 1)

    def test_same_transcript_from_another_origin_retains_canonical_source(self):
        first = self.workflow.prepare(self.run, [self.job['job_id']], 'v2')
        output = Path(self.workflow.complete(first['id'], self.candidate())['result_dir'])
        renamed = self.root / 'exported-again.srt'
        renamed.write_bytes(self.input.read_bytes())
        imported = ingest(renamed, self.workspace, 'demo', provenance={'provider': 'second_export'})
        second = self.workflow.prepare(output, [imported['job_id']], 'v3')
        sources = [json.loads(line) for line in (Path(second['request_path']).parent / 'sources.jsonl').read_text().splitlines()]
        self.assertEqual(len(sources), 2)
        self.assertEqual(sources[-1]['source_name'], self.input.name)

    def test_rejects_new_input_for_reserved_version(self):
        self.workflow.prepare(self.run, [], 'v2')
        with self.assertRaises(WorkflowConflict):
            self.workflow.prepare(self.run, [self.job['job_id']], 'v2')

    def test_rejects_cross_project_or_untranscribed_job(self):
        other = ingest(self.input, self.workspace, 'other')
        with self.assertRaisesRegex(ValueError, 'this project'):
            self.workflow.prepare(self.run, [other['job_id']], 'v2')

    def test_invalid_source_fails_without_publishing_and_can_retry(self):
        task = self.workflow.prepare(self.run, [], 'v2')
        bad = self.candidate()
        bad['requirements'][0]['source_refs'] = ['missing']
        with self.assertRaisesRegex(ValueError, 'unknown source'):
            self.workflow.complete(task['id'], bad)
        self.assertEqual(self.workflow.task(task['id'])['status'], 'failed')
        self.assertFalse((self.workspace / 'versions' / task['id']).exists())
        result = self.workflow.complete(task['id'], self.candidate())
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['attempt'], 2)

    def test_wrong_version_does_not_claim_task(self):
        task = self.workflow.prepare(self.run, [], 'v2')
        with self.assertRaisesRegex(ValueError, 'does not match'):
            self.workflow.complete(task['id'], self.candidate('v3'))
        self.assertEqual(self.workflow.task(task['id'])['attempt'], 0)

    def test_analysis_preserves_locked_field_and_records_conflict(self):
        task = self.workflow.prepare(self.run, [], 'v2')
        candidate = self.candidate()
        candidate['requirements'][0]['behavior'] = '删除全部工单'
        candidate['requirements'][0]['locked_fields'] = []
        result = self.workflow.complete(task['id'], candidate)
        output = Path(result['result_dir'])
        actual = json.loads((output / 'project.json').read_text())
        self.assertEqual(actual['requirements'][0]['behavior'], '筛选工单')
        self.assertIn('behavior', actual['requirements'][0]['locked_fields'])
        self.assertEqual(json.loads((output / 'diff.json').read_text())['conflicts'][0]['proposed'], '删除全部工单')

    def test_review_applies_confirmation_to_new_version(self):
        result = self.workflow.apply_review(self.run, self.notes(), 'v2')
        actual = json.loads((Path(result['result_dir']) / 'project.json').read_text())
        self.assertEqual(actual['requirements'][0]['review_status'], 'confirmed')
        self.assertEqual(actual['baseline_version'], 'v1')
        self.assertEqual(self.workflow.apply_review(self.run, self.notes(), 'v2')['id'], result['id'])

    def test_review_rejects_other_version(self):
        notes = self.notes()
        notes['artifact_version'] = 'other'
        with self.assertRaisesRegex(ValueError, 'different project or artifact version'):
            self.workflow.apply_review(self.run, notes, 'v2')

    def test_changed_requirement_requires_new_confirmation(self):
        project, diff = apply_review(self.project, self.notes(), 'v2', [{'target': 'REQ-001', 'field': 'title', 'value': '工单检索'}])
        self.assertEqual(project['requirements'][0]['review_status'], 'draft')
        self.assertTrue(diff['changes'])

    def test_cancellation_keeps_identity_and_prior_behavior(self):
        result = self.workflow.apply_review(self.run, self.notes('parked'), 'v2', [{'target': 'REQ-001', 'field': 'lifecycle_status', 'value': 'cancelled'}])
        project = json.loads((Path(result['result_dir']) / 'project.json').read_text())
        self.assertEqual(project['requirements'][0]['requirement_id'], 'REQ-001')
        self.assertEqual(project['requirements'][0]['review_status'], 'parked')
        self.assertEqual(project['requirements'][0]['behavior'], '筛选工单')

    def test_context_selection_must_reference_selected_job(self):
        with self.assertRaisesRegex(ValueError, 'included'):
            self.workflow.prepare(self.run, [], 'v2', [self.job['job_id']])
        task = self.workflow.prepare(self.run, [self.job['job_id']], 'v2', [self.job['job_id']])
        request = json.loads(Path(task['request_path']).read_text())
        self.assertEqual(request['context_sources'][0]['association_status'], 'selected_by_user')

    def test_analysis_cannot_promote_unreviewed_requirements(self):
        task = self.workflow.prepare(self.run, [], 'v2')
        project = self.candidate()
        project['requirements'][0]['review_status'] = 'confirmed'
        result = self.workflow.complete(task['id'], project)
        actual = json.loads((Path(result['result_dir']) / 'project.json').read_text())
        self.assertEqual(actual['requirements'][0]['review_status'], 'draft')
