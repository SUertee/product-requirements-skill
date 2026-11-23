"""Designed prototype: FR/NFR gating, coverage, markup checks and end-to-end generation."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'product-requirements/scripts'))
from prototype_design import check_design, validate_nfrs
from prototype_fixture import exercise_designed, service_desk_project


def confirmed_project():
    sources = [{'source_id': f'S{index}', 'source_type': 'transcript'} for index in range(10)]
    project = service_desk_project({'artifact_version': 'v2', 'baseline_version': 'v1'},
                                   {'project_id': 'desk', 'schema_version': '0.1', 'context_sources': [], 'pages': [], 'business_model': {}, 'design_context': {}},
                                   sources)
    for item in project['requirements'] + project['nfrs']:
        item['review_status'] = 'confirmed'
    return project


class PrototypeDesignChecks(unittest.TestCase):
    def test_fixture_design_passes_and_reports_coverage(self):
        _, report = check_design(confirmed_project())
        self.assertEqual(report['requirements']['in_scope'], 4)
        self.assertEqual(sorted(report['requirements']['covered']), ['REQ-001', 'REQ-002', 'REQ-003', 'REQ-004'])
        kinds = {row['nfr_id']: row['kind'] for row in report['nfrs']}
        self.assertEqual(kinds['NFR-007'], 'not_applicable')
        self.assertEqual(kinds['NFR-002'], 'shown')

    def assertRejected(self, project, fragment):
        with self.assertRaises(ValueError) as caught:
            check_design(project)
        self.assertIn(fragment, str(caught.exception))

    def test_feedback_form_must_be_a_feishu_base_share_link(self):
        for url in ['https://example.feishu.cn/share/base/form/shrcnAbc1234567',
                    'https://example.larksuite.com/share/base/shrcnAbc1234567']:
            project = confirmed_project()
            project['prototype_design']['feedback_form_url'] = url
            check_design(project)
        for url in ['http://example.feishu.cn/share/base/shrcnAbc1234567', 'https://evil.test/share/base/shrcnAbc1234567',
                    'https://example.feishu.cn/docx/abc', 'javascript:alert(1)']:
            project = confirmed_project()
            project['prototype_design']['feedback_form_url'] = url
            self.assertRejected(project, 'feedback_form_url')

    def test_unconfirmed_requirement_blocks_generation(self):
        project = confirmed_project()
        project['requirements'][0]['review_status'] = 'draft'
        self.assertRejected(project, 'REQ-001 must be confirmed')

    def test_missing_acceptance_blocks_generation(self):
        project = confirmed_project()
        project['requirements'][1]['acceptance_criteria'] = None
        self.assertRejected(project, 'REQ-002 needs acceptance criteria')

    def test_confirmed_requirement_must_be_covered_or_excluded(self):
        project = confirmed_project()
        page = project['prototype_design']['pages'][1]
        page['requirement_ids'] = []
        page['markup'] = page['markup'].replace('data-req="REQ-001"', '')
        self.assertRejected(project, 'without a prototype page or exclusion reason: REQ-001')
        project['prototype_design']['excluded_requirements'] = [{'requirement_id': 'REQ-001', 'reason': '由呼叫中心系统创建'}]
        _, report = check_design(project)
        self.assertEqual(report['requirements']['excluded'][0]['requirement_id'], 'REQ-001')

    def test_declared_requirement_needs_annotation_in_markup(self):
        project = confirmed_project()
        page = project['prototype_design']['pages'][0]
        page['markup'] = page['markup'].replace('data-req="REQ-003"', '')
        self.assertRejected(project, 'does not mark REQ-003')

    def test_confirmed_nfr_must_be_shown_or_marked_not_applicable(self):
        project = confirmed_project()
        project['prototype_design']['positioning']['nfr_ids'] = []
        self.assertRejected(project, 'NFR-002 is confirmed but not shown')

    def test_markup_rejects_scripts_external_resources_and_inline_handlers(self):
        for injected, fragment in [('<script>alert(1)</script>', '<script> is not allowed'),
                                   ('<img src="https://example.com/a.png">', 'external or scripted resource'),
                                   ('<a href="javascript:alert(1)">x</a>', 'external or scripted resource'),
                                   ('<button onclick="x()">x</button>', 'inline handler onclick'),
                                   ('<a data-goto="missing">x</a>', 'unknown pages missing')]:
            project = confirmed_project()
            project['prototype_design']['pages'][0]['markup'] += injected
            self.assertRejected(project, fragment)

    def test_script_and_css_cannot_escape_their_elements(self):
        project = confirmed_project()
        project['prototype_design']['pages'][0]['script'] += '</script><script>alert(1)'
        self.assertRejected(project, 'must not close the script element')
        project = confirmed_project()
        project['prototype_design']['pages'][0]['css'] += '@import url(https://example.com/x.css);'
        self.assertRejected(project, 'css must be plain rules')

    def test_declared_state_needs_matching_element(self):
        project = confirmed_project()
        project['prototype_design']['pages'][2]['states'].append('error')
        self.assertRejected(project, 'states without data-state elements: error')

    def test_nfr_structure_is_validated_with_project_inputs(self):
        project = confirmed_project()
        sources = {f'S{index}' for index in range(10)}
        validate_nfrs(project, {'REQ-001', 'REQ-002', 'REQ-003', 'REQ-004'}, sources)
        broken = copy.deepcopy(project)
        broken['nfrs'][0]['category'] = 'speed'
        with self.assertRaises(ValueError):
            validate_nfrs(broken, set(), sources)


class DesignedPrototypeEndToEnd(unittest.TestCase):
    def test_meeting_to_confirmed_fr_nfr_to_designed_prototype(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = exercise_designed(Path(temporary))
            v1 = json.loads((result['v1'] / 'project.json').read_text())
            self.assertTrue(all(item['review_status'] == 'draft' for item in v1['nfrs']))
            review = json.loads((result['v1'] / 'review.json').read_text())
            self.assertTrue(any(question['target'] == 'NFR-001' for question in review['questions']))
            v2 = json.loads((result['v2'] / 'project.json').read_text())
            self.assertTrue(all(item['review_status'] == 'confirmed' for item in v2['nfrs']))
            outcome = result['generation']['generation_results'][0]
            self.assertEqual(outcome['generation_status'], 'success', outcome.get('error'))
            html = (result['v3'] / 'prototype/index.html').read_text()
            self.assertIn('window.Prototype', html)
            self.assertNotIn('<script>alert', html)
            self.assertEqual(len(outcome['coverage']['pages']), 3)
            recorded = json.loads((result['v3'] / 'generation.json').read_text())['results'][0]
            self.assertEqual(recorded['coverage']['requirements']['in_scope'], 4)

    def test_generation_from_unconfirmed_version_fails_without_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = exercise_designed(Path(temporary))
            from workflow import Workflow
            generation = Workflow(result['workspace']).generate(result['v1'], 'v9', ['prototype'])
            outcome = generation['generation_results'][0]
            self.assertEqual(outcome['generation_status'], 'failed')
            self.assertIn('confirmed', outcome['error'])
            self.assertFalse((Path(generation['result_dir']) / 'prototype/index.html').exists())


    def test_applying_review_keeps_the_generated_prototype(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = exercise_designed(Path(temporary))
            from workflow import Workflow
            notes = {'project_id': 'desk', 'artifact_version': 'v3', 'review_stage': 'definition', 'decisions': []}
            task = Workflow(result['workspace']).apply_review(result['v3'], notes, 'v4')
            self.assertEqual([item['capability'] for item in task['generation_results'] if item['generation_status'] == 'success'], ['prototype'])
            self.assertTrue((Path(task['result_dir']) / 'prototype/index.html').is_file())

if __name__ == '__main__':
    unittest.main()
