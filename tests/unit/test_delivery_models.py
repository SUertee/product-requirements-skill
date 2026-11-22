import json
from pathlib import Path
import sys
import tempfile
import unittest
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from generate_manifest import artifact_type_for, delivery_trace
from project_lib import project_errors, read_json, write_json
from render_artifacts import render_project

MODEL_NAMES = ("technical-design.json", "delivery-plan.json", "deck-brief.json")


class DeliveryModelTests(unittest.TestCase):
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

    def model_path(self, name):
        return self.root / "models" / name

    def test_legacy_project_without_optional_models_still_renders(self):
        for name in MODEL_NAMES:
            self.model_path(name).unlink()
        render_project(self.root)
        self.assertEqual(project_errors(self.root), [])
        self.assertFalse((self.root / "artifacts" / "schedule" / "index.html").exists())
        self.assertFalse((self.root / "artifacts" / "technical-design.md").exists())
        workbench = (self.root / "artifacts" / "workbench" / "index.html").read_text(encoding="utf-8")
        self.assertIn("技术设计待需求基线后生成", workbench)
        self.assertIn("PPT 简报待生成", workbench)

    def test_schedule_rejects_invalid_dates_dependencies_and_references(self):
        path = self.model_path("delivery-plan.json")
        plan = read_json(path)
        plan["items"][0]["end_date"] = "2026-11-01"
        plan["items"][1]["dependencies"] = ["WORK-NOT-FOUND"]
        plan["items"][2]["requirement_ids"] = ["REQ-NOT-FOUND"]
        plan["items"][3]["status"] = "confirmed"
        write_json(path, plan)
        errors = project_errors(self.root)
        self.assertTrue(any("end_date precedes start_date" in error for error in errors))
        self.assertTrue(any("unknown dependency" in error for error in errors))
        self.assertTrue(any("unknown requirement REQ-NOT-FOUND" in error for error in errors))
        self.assertTrue(any("confirmed item requires an owner" in error for error in errors))
        self.assertTrue(any("confirmed item requires confirmed dates" in error for error in errors))

    def test_all_unscheduled_plan_has_empty_timeline_not_invented_dates(self):
        path = self.model_path("delivery-plan.json")
        plan = read_json(path)
        for item in plan["items"]:
            item["status"] = "proposed"
            item["owner"] = None
            item["start_date"] = item["end_date"] = None
        write_json(path, plan)
        render_project(self.root)
        self.assertEqual(project_errors(self.root), [])
        schedule = (self.root / "artifacts" / "schedule" / "index.html").read_text(encoding="utf-8")
        self.assertIn("暂无可绘制的时间轴", schedule)
        self.assertNotIn("class='schedule-bar", schedule)

    def test_generated_diagram_requires_drawio_and_verified_requires_png(self):
        path = self.model_path("technical-design.json")
        technical = read_json(path)
        technical["diagrams"][0]["status"] = "generated"
        write_json(path, technical)
        errors = project_errors(self.root)
        self.assertTrue(any("generated diagram requires drawio_path" in error for error in errors))
        self.assertFalse(any("generated diagram requires png_path" in error for error in errors))
        technical["diagrams"][0]["status"] = "verified"
        write_json(path, technical)
        errors = project_errors(self.root)
        self.assertTrue(any("verified diagram requires png_path" in error for error in errors))

    def test_exported_deck_requires_structurally_valid_pptx(self):
        path = self.model_path("deck-brief.json")
        brief = read_json(path)
        brief.update({
            "review_status": "approved", "export_status": "exported",
            "output_paths": ["artifacts/deck/demo.pptx"],
        })
        write_json(path, brief)
        output = self.root / "artifacts" / "deck" / "demo.pptx"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(b"not a pptx")
        self.assertTrue(any("invalid PPTX package" in error for error in project_errors(self.root)))
        with ZipFile(output, "w") as package:
            package.writestr("[Content_Types].xml", "<Types xmlns='http://schemas.openxmlformats.org/package/2006/content-types'/>")
            package.writestr("ppt/presentation.xml", "<presentation/>")
        self.assertEqual(project_errors(self.root), [])

    def test_exported_html_must_be_real_html(self):
        path = self.model_path("deck-brief.json")
        brief = read_json(path)
        brief.update({
            "review_status": "approved", "export_status": "exported",
            "output_paths": ["artifacts/deck/index.html"],
        })
        write_json(path, brief)
        output = self.root / "artifacts" / "deck" / "index.html"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text("not html", encoding="utf-8")
        self.assertTrue(any("invalid HTML deck" in error for error in project_errors(self.root)))
        output.write_text("<!doctype html><html lang='zh-CN'><body>deck</body></html>", encoding="utf-8")
        self.assertEqual(project_errors(self.root), [])

    def test_invalid_model_shape_returns_validation_error(self):
        write_json(self.model_path("delivery-plan.json"), [])
        errors = project_errors(self.root)
        self.assertTrue(any("expected type object" in error for error in errors))

    def test_dependency_cycle_is_rejected(self):
        path = self.model_path("delivery-plan.json")
        plan = read_json(path)
        plan["items"][0]["dependencies"] = ["WORK-002"]
        plan["items"][1]["dependencies"] = ["WORK-001"]
        write_json(path, plan)
        self.assertTrue(any("dependency cycle" in error for error in project_errors(self.root)))

    def test_unregistered_actual_deck_file_is_rejected(self):
        output = self.root / "artifacts" / "deck" / "unexpected.html"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text("<html><body>unexpected</body></html>", encoding="utf-8")
        self.assertTrue(any("before export is confirmed" in error for error in project_errors(self.root)))
        path = self.model_path("deck-brief.json")
        brief = read_json(path)
        brief.update({"review_status": "approved", "export_status": "exported", "output_paths": []})
        write_json(path, brief)
        errors = project_errors(self.root)
        self.assertTrue(any("exported deck requires output_paths" in error for error in errors))
        self.assertTrue(any("actual deck file is not registered" in error for error in errors))

    def test_manifest_types_and_specific_req_trace(self):
        self.assertEqual(artifact_type_for("artifacts/schedule/index.html"), "schedule")
        self.assertEqual(artifact_type_for("artifacts/deck-handdrawn/demo.pptx"), "deck")
        self.assertEqual(artifact_type_for("artifacts/technical-design.md"), "technical_design")
        traced = delivery_trace(self.root, "schedule", [])
        self.assertEqual(traced, ["REQ-001", "REQ-002", "REQ-003"])
        self.assertNotIn("REQ-004", traced)
    def test_full_review_documents_have_specific_artifact_types(self):
        expected = {
            "artifacts/proposal-full.md": "proposal",
            "artifacts/prd-full.md": "prd",
            "artifacts/technical-design-full.md": "technical_design",
            "artifacts/changelog-v1.1.md": "review",
        }
        for relative, artifact_type in expected.items():
            self.assertEqual(artifact_type_for(relative), artifact_type)
            self.assertNotEqual(artifact_type_for(relative), "business_model")


if __name__ == "__main__":
    unittest.main()
