"""Regression checks for evidence integrity and preserving existing review work."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'product-requirements/scripts/build_documents.py'
spec = importlib.util.spec_from_file_location('build_documents', SCRIPT)
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class DocumentBundleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.project_path = self.root / 'project.json'
        self.sources_path = self.root / 'sources.jsonl'
        self.project = {
            'project_id': 'demo', 'schema_version': '0.1', 'artifact_version': 'v0.1',
            'baseline_version': None, 'context_sources': [],
            'requirement_profile': {'business_scenario': '售后工单查询'},
            'business_model': {}, 'pages': [], 'design_context': {},
            'requirements': [{
                'requirement_id': 'REQ-001', 'title': '按状态查询工单',
                'role': '客服', 'trigger': '打开列表', 'behavior': '筛选状态后查看工单',
                'source_refs': ['SRC-001'], 'evidence_type': 'explicit',
                'review_status': 'draft', 'locked_fields': ['behavior'],
            }],
        }
        self.source = {'source_id': 'SRC-001', 'project_id': 'demo', 'text': '希望按状态查工单。', 'locator': {'paragraph': 1}}
        self.save()

    def save(self):
        self.project_path.write_text(json.dumps(self.project))
        self.sources_path.write_text(json.dumps(self.source) + '\n')

    def read(self):
        return build.read_inputs(self.project_path, self.sources_path)

    def test_technical_architecture_validates_separate_components(self):
        self.project['technical_architecture'] = {
            'review_status': 'draft', 'requirement_ids': ['REQ-001'], 'source_refs': ['SRC-001'],
            'layers': [{'id': 'service', 'name': '服务层'}],
            'components': [{'id': 'api', 'name': '查询 API', 'layer': 'service'}],
            'connections': [],
        }
        self.save()
        self.assertIn('technical_architecture', self.read()[0])
        self.project['technical_architecture']['components'][0]['requirement_ids'] = ['missing']
        self.save()
        with self.assertRaisesRegex(ValueError, 'Component has invalid requirement_ids'):
            self.read()
        self.project['technical_architecture']['components'][0]['requirement_ids'] = ['REQ-001']

        self.project['technical_architecture']['connections'] = [{'from': 'api', 'to': 'missing'}]
        self.save()
        with self.assertRaisesRegex(ValueError, 'known components'):
            self.read()

    def test_bundle_keeps_evidence_and_locked_fields(self):
        project, sources = self.read()
        destination = self.root / 'v0.1'
        before = copy.deepcopy(project)
        build.publish(project, sources, destination)
        self.assertEqual(project, before)
        self.assertEqual(json.loads((destination / 'project.json').read_text()), before)
        self.assertIn('SRC-001', (destination / 'prd.md').read_text())
        self.assertIn('希望按状态查工单', (destination / 'prd.md').read_text())
        manifest = json.loads((destination / 'manifest.json').read_text())
        self.assertEqual(len(manifest['artifacts']), 6)
        for artifact in manifest['artifacts']:
            self.assertEqual(artifact['review_status'], 'draft')
            self.assertEqual(artifact['sha256'], hashlib.sha256((destination / artifact['path']).read_bytes()).hexdigest())
        review = json.loads((destination / 'review.json').read_text())
        self.assertEqual(review['decisions'], [])
        self.assertTrue(any(item.get('field') == 'acceptance_criteria' for item in review['questions']))

    def test_meeting_highlights_require_citations_from_their_materials(self):
        self.project['materials'] = [
            {'material_id': 'M1', 'source_ids': ['SRC-001']},
            {'material_id': 'M2', 'source_ids': []},
        ]
        meeting = {'meeting_id': 'MEETING-1', 'material_ids': ['M1'],
                   'highlights': [{'text': '按状态查询工单', 'source_refs': ['SRC-001']}]}
        self.project['meetings'] = [meeting]
        self.save()
        self.read()
        for material_ids, citations in [(['M1'], []), (['M1'], ['unknown']), (['M2'], ['SRC-001'])]:
            with self.subTest(material_ids=material_ids, citations=citations):
                meeting['material_ids'] = material_ids
                meeting['highlights'][0]['source_refs'] = citations
                self.save()
                with self.assertRaisesRegex(ValueError, 'Meeting highlights need sources'):
                    self.read()

    def test_duplicate_requirement_rejected(self):
        self.project['requirements'].append(copy.deepcopy(self.project['requirements'][0]))
        self.save()
        with self.assertRaisesRegex(ValueError, 'duplicate requirement'):
            self.read()

    def test_unknown_source_rejected(self):
        self.project['requirements'][0]['source_refs'] = ['missing']
        self.save()
        with self.assertRaisesRegex(ValueError, 'unknown source'):
            self.read()

    def test_cross_project_source_rejected(self):
        self.source['project_id'] = 'other-customer'
        self.save()
        with self.assertRaisesRegex(ValueError, 'different project'):
            self.read()

    def test_page_cannot_reference_missing_requirement(self):
        self.project['pages'] = [{'page_id': 'PAGE-001', 'requirement_ids': ['missing']}]
        self.save()
        with self.assertRaisesRegex(ValueError, 'invalid requirement_ids'):
            self.read()

    def test_existing_review_work_is_preserved(self):
        project, sources = self.read()
        destination = self.root / 'existing'
        destination.mkdir()
        review = destination / 'review.json'
        review.write_text('human review')
        with self.assertRaisesRegex(ValueError, 'already exists'):
            build.publish(project, sources, destination)
        self.assertEqual(review.read_text(), 'human review')

    def test_failed_render_leaves_no_output_or_lock(self):
        project, sources = self.read()
        destination = self.root / 'failed'
        original = build.render
        try:
            def fail(*args):
                raise ValueError('renderer failed')
            build.render = fail
            with self.assertRaisesRegex(ValueError, 'renderer failed'):
                build.publish(project, sources, destination)
        finally:
            build.render = original
        self.assertFalse(destination.exists())
        self.assertFalse((self.root / '.failed.build.lock').exists())
        self.assertEqual(list(self.root.glob('.failed.*')), [])

    def test_concurrent_reservation_is_respected(self):
        project, sources = self.read()
        lock = self.root / '.reserved.build.lock'
        lock.write_text('other process')
        with self.assertRaises(FileExistsError):
            build.publish(project, sources, self.root / 'reserved')
        self.assertEqual(lock.read_text(), 'other process')

    def test_imported_markdown_is_literal(self):
        self.source['text'] = '# injected\n[external](https://example.com)'
        self.save()
        project, sources = self.read()
        build.publish(project, sources, self.root / 'literal')
        text = (self.root / 'literal/prd.md').read_text()
        self.assertNotIn('\n# injected', text)
        self.assertNotIn('[external](https://example.com)', text)

    def test_workbench_embeds_literal_data_and_no_invented_outputs(self):
        self.source['text'] = '</script><script>alert(1)</script>'
        self.project['modules'] = [{'module_id': 'MOD-001', 'name': '工单查询', 'requirement_ids': ['REQ-001']}]
        self.save()
        project, sources = self.read()
        destination = self.root / 'workbench'
        build.publish(project, sources, destination)
        page = (destination / 'workbench/index.html').read_text()
        self.assertNotIn(self.source['text'], page)
        start = page.index('<script id="workbench-data" type="application/json">') + len('<script id="workbench-data" type="application/json">')
        payload = json.loads(page[start:page.index('</script>', start)])
        self.assertEqual(payload['sources'][0]['text'], self.source['text'])
        self.assertEqual(payload['project']['modules'][0]['module_id'], 'MOD-001')
        self.assertFalse(any(item['path'].startswith('prototype/') for item in payload['artifacts']))

    def test_module_must_reference_existing_requirement(self):
        self.project['modules'] = [{'module_id': 'MOD-001', 'requirement_ids': ['REQ-404']}]
        self.save()
        with self.assertRaisesRegex(ValueError, 'invalid requirement_ids'):
            self.read()

    def test_materials_are_copied_with_explicit_root_and_listed(self):
        assets = self.root / 'assets'
        assets.mkdir()
        (assets / 'background.txt').write_text('Approved synthetic background')
        self.project['materials'] = [{'material_id': 'MAT-001', 'path': 'background.txt', 'source_ids': ['SRC-001']}]
        self.save()
        project, sources = self.read()
        destination = self.root / 'attached'
        build.publish(project, sources, destination, assets)
        self.assertEqual((destination / 'materials/background.txt').read_text(), 'Approved synthetic background')
        manifest = json.loads((destination / 'manifest.json').read_text())
        attachment = next(item for item in manifest['artifacts'] if item.get('material_id') == 'MAT-001')
        self.assertEqual(attachment['path'], 'materials/background.txt')

    def test_material_paths_cannot_escape_selected_root(self):
        self.project['materials'] = [{'material_id': 'MAT-001', 'path': '../outside.txt'}]
        self.save()
        project, sources = self.read()
        with self.assertRaisesRegex(ValueError, 'within materials root'):
            build.publish(project, sources, self.root / 'escape', self.root)
        self.assertFalse((self.root / 'escape').exists())

    def test_material_symlink_cannot_read_outside_root(self):
        assets = self.root / 'assets'
        assets.mkdir()
        (assets / 'linked.txt').symlink_to(self.project_path)
        self.project['materials'] = [{'material_id': 'MAT-001', 'path': 'linked.txt'}]
        self.save()
        project, sources = self.read()
        with self.assertRaisesRegex(ValueError, 'within materials root'):
            build.publish(project, sources, self.root / 'symlink', assets)

    def test_material_copy_requires_explicit_root(self):
        self.project['materials'] = [{'material_id': 'MAT-001', 'path': 'background.txt'}]
        self.save()
        project, sources = self.read()
        with self.assertRaisesRegex(ValueError, 'materials-root'):
            build.publish(project, sources, self.root / 'unconfigured')

    def test_meeting_cannot_reference_missing_material(self):
        self.project['meetings'] = [{'meeting_id': 'MEET-001', 'material_ids': ['missing']}]
        self.save()
        with self.assertRaisesRegex(ValueError, 'invalid material_ids'):
            self.read()


if __name__ == '__main__':
    unittest.main()
