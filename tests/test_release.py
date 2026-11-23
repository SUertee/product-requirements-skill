"""Customer package scope, review and dependency acceptance checks."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'product-requirements/scripts'))
from build_documents import publish
from prototype import generate_prototype
from release_package import build_release


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = {'project_id': 'demo', 'name': '合成原型', 'schema_version': '0.1', 'artifact_version': 'v1', 'baseline_version': None,
                        'context_sources': [{'text': 'INTERNAL_PRIVATE_NOTE'}], 'requirement_profile': {}, 'business_model': {}, 'design_context': {},
                        'requirements': [{'requirement_id': 'REQ-001', 'title': '创建', 'behavior': '输入后提交', 'acceptance_criteria': '有结果', 'review_status': 'confirmed', 'evidence_type': 'explicit', 'source_refs': ['SRC-1']}],
                        'pages': [{'page_id': 'form', 'requirement_ids': ['REQ-001'], 'fields': [{'id': 'title', 'label': '主题', 'required': True}], 'actions': [{'id': 'save', 'label': '提交', 'type': 'submit'}]}]}
        self.source = {'source_id': 'SRC-1', 'project_id': 'demo', 'text': 'PRIVATE_RAW_TRANSCRIPT', 'locator': {'paragraph': 1}}
        artifact_root = self.root / 'artifacts'
        record = generate_prototype(self.project, artifact_root)
        record.update(artifact_version='v1', source_ids=['SRC-1'])
        self.run = self.root / 'run'
        publish(self.project, {'SRC-1': self.source}, self.run, artifact_root=artifact_root, artifact_records=[record])
        self.notes = {'project_id': 'demo', 'artifact_version': 'v1', 'decisions': [{'decision_id': 'D1', 'target': 'prototype/index.html', 'outcome': 'confirmed', 'artifact_version': 'v1', 'review_stage': 'release'}]}

    def test_release_contains_only_customer_assets_and_metadata(self):
        release = build_release(self.run, self.root / 'workspace', ['prototype/index.html'], self.notes)
        archive = self.root / 'workspace/releases' / release['release_id'] / 'package.zip'
        with zipfile.ZipFile(archive) as package:
            self.assertEqual(set(package.namelist()), {'index.html', 'prototype/index.html', 'manifest.json', 'release.json'})
            text = '\n'.join(package.read(name).decode() for name in package.namelist())
            self.assertNotIn('PRIVATE_RAW_TRANSCRIPT', text)
            self.assertNotIn('INTERNAL_PRIVATE_NOTE', text)
        self.assertEqual(release['deployment_status'], 'package_ready')
        self.assertIsNone(release['deployment_url'])
        again = build_release(self.run, self.root / 'workspace', ['prototype/index.html'], self.notes)
        self.assertEqual(again['release_id'], release['release_id'])

    def test_release_requires_final_review_of_the_same_version(self):
        self.notes['decisions'][0]['review_stage'] = 'definition'
        with self.assertRaisesRegex(ValueError, 'final release confirmation'):
            build_release(self.run, self.root / 'workspace', ['prototype/index.html'], self.notes)
        self.notes['artifact_version'] = 'v0'
        with self.assertRaisesRegex(ValueError, 'match this project'):
            build_release(self.run, self.root / 'workspace', ['prototype/index.html'], self.notes)

    def test_cannot_release_internal_files_even_if_marked_confirmed(self):
        self.notes['decisions'][0]['target'] = 'prd.md'
        with self.assertRaisesRegex(ValueError, 'Only prototype'):
            build_release(self.run, self.root / 'workspace', ['prd.md'], self.notes)

    def test_tampered_prototype_requires_regeneration_and_review(self):
        with (self.run / 'prototype/index.html').open('a') as file:
            file.write('changed')
        with self.assertRaisesRegex(ValueError, 'changed after generation'):
            build_release(self.run, self.root / 'workspace', ['prototype/index.html'], self.notes)
