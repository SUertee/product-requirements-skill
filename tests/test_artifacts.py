"""Artifact registration, reviewed prototype and configured skill adapter checks."""
import copy
import importlib.util
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'product-requirements/scripts'))
import build_documents as build
from generate_artifacts import archify_modules, generate, schema_canvas
from prototype import generate_prototype
from workflow import Workflow


class ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = {'project_id': 'demo', 'name': '合成售后工具', 'schema_version': '0.1', 'artifact_version': 'v1', 'baseline_version': None,
                        'context_sources': [], 'requirement_profile': {}, 'business_model': {'entities': [{'name': 'Ticket', 'fields': [{'name': 'subject', 'type': 'text'}]}]}, 'design_context': {},
                        'requirements': [{'requirement_id': 'REQ-001', 'title': '创建工单', 'behavior': '填写主题后创建工单', 'acceptance_criteria': '必填主题后可提交，显示示例编号', 'source_refs': ['SRC-1'], 'evidence_type': 'explicit', 'review_status': 'confirmed'}],
                        'pages': [{'page_id': 'create', 'name': '创建工单', 'requirement_ids': ['REQ-001'], 'fields': [{'id': 'subject', 'label': '工单主题', 'required': True}], 'actions': [{'id': 'save', 'type': 'submit', 'label': '创建'}]}]}
        self.sources = {'SRC-1': {'source_id': 'SRC-1', 'project_id': 'demo', 'text': '输入主题，创建工单后显示编号。', 'locator': {'paragraph': 1}}}

    def test_registered_artifact_is_in_manifest_and_workbench(self):
        generated = self.root / 'generated'
        record = generate_prototype(self.project, generated)
        record.update(artifact_version='v1', source_ids=['SRC-1'], depends_on=['project.json'])
        run = self.root / 'run'
        build.publish(self.project, self.sources, run, artifact_root=generated, artifact_records=[record])
        manifest = json.loads((run / 'manifest.json').read_text())
        artifact = next(item for item in manifest['artifacts'] if item['path'] == 'prototype/index.html')
        self.assertEqual(artifact['generator'], 'product-requirements/prototype')
        self.assertEqual(artifact['audience'], 'internal')
        self.assertTrue((run / artifact['path']).is_file())
        self.assertIn('prototype/index.html', (run / 'workbench/index.html').read_text())

    def test_module_diagram_is_generated_and_embedded_in_workbench(self):
        self.project['modules'] = [{'module_id': 'support', 'name': '客服', 'requirement_ids': ['REQ-001']}]
        try:
            record = archify_modules(self.project, self.root)
        except ValueError as error:
            if 'Missing Skill entrypoint' in str(error):
                self.skipTest(str(error))
            raise
        record.update(artifact_version='v1', source_ids=['SRC-1'])
        build.publish(self.project, self.sources, self.root / 'with-map', artifact_root=self.root, artifact_records=[record])
        text = (self.root / 'with-map/workbench/index.html').read_text()
        self.assertIn('module_0', text)
        self.assertIn('module_diagram', text)

    def test_module_relations_reject_unknown_module_ids(self):
        self.project['module_relations'] = [{'from': 'missing', 'to': 'another', 'label': '客户资料'}]
        path = self.root / 'project.json'
        path.write_text(json.dumps(self.project))
        sources = self.root / 'sources.jsonl'
        sources.write_text(json.dumps(self.sources['SRC-1']))
        with self.assertRaisesRegex(ValueError, 'known module IDs'):
            build.read_inputs(path, sources)

    def test_artifact_cannot_escape_root_or_use_other_version(self):
        root = self.root / 'artifacts'
        root.mkdir()
        record = {'path': '../outside.html', 'generator': 'test', 'artifact_version': 'v1', 'source_ids': []}
        with self.assertRaisesRegex(ValueError, 'deliverable directory'):
            build.publish(self.project, self.sources, self.root / 'invalid', artifact_root=root, artifact_records=[record])
        record.update(path='prototype/index.html', artifact_version='v2')
        with self.assertRaisesRegex(ValueError, 'version mismatch'):
            build.publish(self.project, self.sources, self.root / 'invalid', artifact_root=root, artifact_records=[record])

    def test_prototype_requires_confirmation_and_page_behavior(self):
        self.project['requirements'][0]['review_status'] = 'draft'
        with self.assertRaisesRegex(ValueError, 'confirmed behavior'):
            generate_prototype(self.project, self.root)
        self.project['requirements'][0]['review_status'] = 'confirmed'
        self.project['pages'][0]['actions'] = []
        with self.assertRaisesRegex(ValueError, 'Define page actions'):
            generate_prototype(self.project, self.root)

    def test_prototype_payload_contains_only_customer_screen_spec(self):
        self.project['context_sources'] = [{'text': 'INTERNAL_PRIVATE_NOTE'}]
        self.project['pages'][0]['task'] = '</script><script>alert(1)</script>'
        generate_prototype(self.project, self.root)
        text = (self.root / 'prototype/index.html').read_text()
        self.assertNotIn('INTERNAL_PRIVATE_NOTE', text)
        self.assertNotIn(self.project['pages'][0]['task'], text)
        self.assertIn('DEMO-', text)

    def test_missing_capability_preserves_independent_generation(self):
        with patch('generate_artifacts.resolve', side_effect=ValueError('Dependency missing')):
            records, results = generate(self.project, self.sources, self.root, ['workflow', 'prototype'])
        self.assertEqual(len(records), 1)
        self.assertEqual(results['results'][0]['generation_status'], 'failed')
        self.assertEqual(records[0]['path'], 'prototype/index.html')

    def test_each_flow_is_generated_with_independent_failure_status(self):
        self.project['business_model']['flows'] = [{'id': 'first'}, {'id': 'second'}]
        record = {'path': 'diagrams/workflow-2.html', 'generator': 'fixture', 'validation_results': []}
        with patch('generate_artifacts.archify_workflow', side_effect=[ValueError('First flow incomplete'), record]) as adapter:
            records, result = generate(self.project, self.sources, self.root, ['workflow'])
        self.assertEqual([call.args[2] for call in adapter.call_args_list], [0, 1])
        self.assertEqual([item['generation_status'] for item in result['results']], ['failed', 'success'])
        self.assertEqual(records[0]['path'], 'diagrams/workflow-2.html')

    def test_generation_is_published_as_new_version(self):
        run = self.root / 'v1'
        build.publish(self.project, self.sources, run)
        workflow = Workflow(self.root / 'workspace')
        task = workflow.generate(run, 'v2', ['prototype'])
        output = Path(task['result_dir'])
        self.assertTrue((output / 'prototype/index.html').is_file())
        generation = json.loads((output / 'generation.json').read_text())
        self.assertEqual(generation['results'][0]['generation_status'], 'success')
        self.assertFalse((run / 'prototype/index.html').exists())

    def test_adding_module_map_regenerates_existing_prototype_at_same_version(self):
        run = self.root / 'v1'
        build.publish(self.project, self.sources, run)
        workflow = Workflow(self.root / 'workspace')
        v2 = Path(workflow.generate(run, 'v2', ['prototype'])['result_dir'])
        def module_map(project, root):
            output = Path(root) / 'diagrams/modules.html'
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text('<!doctype html><title>Fixture modules</title>')
            return {'path': 'diagrams/modules.html', 'generator': 'fixture', 'validation_results': []}
        with patch('generate_artifacts.archify_modules', side_effect=module_map):
            task = workflow.generate(v2, 'v3', ['modules'])
        v3 = Path(task['result_dir'])
        self.assertTrue((v3 / 'diagrams/modules.html').is_file())
        self.assertTrue((v3 / 'prototype/index.html').is_file())
        self.assertIn('v3', (v3 / 'prototype/index.html').read_text())
        self.assertEqual({item['capability'] for item in task['generation_results']}, {'modules', 'prototype'})

    def test_generation_failure_keeps_documents_and_reason(self):
        self.project['requirements'][0]['review_status'] = 'draft'
        run = self.root / 'v1'
        build.publish(self.project, self.sources, run)
        workflow = Workflow(self.root / 'workspace')
        task = workflow.generate(run, 'v2', ['prototype'])
        output = Path(task['result_dir'])
        self.assertFalse((output / 'prototype/index.html').exists())
        self.assertTrue((output / 'prd.md').is_file())
        self.assertEqual(json.loads((output / 'generation.json').read_text())['results'][0]['generation_status'], 'failed')

    def test_malformed_page_fields_report_independent_generation_failure(self):
        self.project['pages'][0]['fields'] = [None]
        records, results = generate(self.project, self.sources, self.root, ['prototype'])
        self.assertEqual(records, [])
        self.assertEqual(results['results'][0]['generation_status'], 'failed')
        self.assertIn('field specifications', results['results'][0]['error'])

    def test_schema_adapter_replaces_reference_project_and_ids(self):
        package = Path(__file__).resolve().parents[2] / 'skill-dependencies/schema-canvas'
        if not package.is_dir():
            self.skipTest('Configured local Schema Canvas reference is unavailable')
        with patch('generate_artifacts.resolve', return_value=package):
            record = schema_canvas(self.project, self.root)
        text = (self.root / record['path']).read_text()
        self.assertNotIn('FinDesk', text)
        self.assertNotIn('statement_import_records', text)
        payload = json.loads(re.search(r'id="schemaData">(.*?)</script>', text, re.S)[1])
        self.assertEqual([item['id'] for item in payload['tables']], ['Ticket'])
        self.assertEqual(payload['tables'][0]['columns'][0]['type'], 'text')
