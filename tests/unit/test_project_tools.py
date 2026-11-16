import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from project_lib import evidence_errors, locked_changes, project_errors, read_json, read_jsonl, write_json, write_jsonl
from render_artifacts import render_project


class ProjectToolsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "project"
        source = ROOT / "examples" / "output" / "demo"
        for path in source.rglob("*"):
            if path.is_file():
                target = self.root / path.relative_to(source)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(path.read_bytes())

    def tearDown(self):
        self.temp.cleanup()

    def test_demo_project_and_all_schemas_load(self):
        self.assertEqual(project_errors(self.root), [])
        for schema in (ROOT / "schemas").glob("*.schema.json"):
            self.assertIsInstance(json.loads(schema.read_text(encoding="utf-8")), dict)

    def test_fake_quote_missing_segment_and_inferred_e1_fail(self):
        path = self.root / "evidence" / "evidence.jsonl"
        rows = read_jsonl(path)
        rows[0]["original_quote"] = "模型编造的原话"
        rows[1]["segment_id"] = "SEG-NOT-FOUND"
        rows[2]["is_inferred"] = True
        write_jsonl(path, rows)
        errors = evidence_errors(self.root)
        self.assertTrue(any("verbatim substring" in error for error in errors))
        self.assertTrue(any("does not exist" in error for error in errors))
        self.assertTrue(any("cannot be E1" in error for error in errors))

    def test_duplicate_req_and_unknown_evidence_fail(self):
        path = self.root / "requirements" / "requirements.json"
        data = read_json(path)
        data["requirements"][1]["requirement_id"] = data["requirements"][0]["requirement_id"]
        data["requirements"][2]["evidence_ids"] = ["EVD-NOT-FOUND"]
        write_json(path, data)
        errors = project_errors(self.root)
        self.assertTrue(any("duplicate requirement_id" in error for error in errors))
        self.assertTrue(any("unknown evidence_id" in error for error in errors))

    def test_whole_and_field_locks(self):
        old = {"title": "旧", "constraints": ["A"], "locked_by_human": True, "locked_fields": []}
        self.assertIn("title", locked_changes(old, {**old, "title": "新"}))
        old["locked_by_human"] = False; old["locked_fields"] = ["constraints"]
        self.assertEqual(locked_changes(old, {**old, "title": "新"}), [])
        self.assertEqual(locked_changes(old, {**old, "constraints": ["B"]}), ["constraints"])

    def test_prototype_requires_baseline(self):
        project_path = self.root / "project.json"
        project = read_json(project_path); project["current_baseline_id"] = None
        write_json(project_path, project)
        with self.assertRaisesRegex(ValueError, "approved current baseline"):
            render_project(self.root, include_prototype=True)


if __name__ == "__main__":
    unittest.main()
