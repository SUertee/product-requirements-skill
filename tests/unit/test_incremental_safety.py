import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from artifact_state import ManualArtifactConflict
from diff_requirements import analyze_impacts
from project_lib import read_json, write_json
from render_artifacts import ARTIFACT_FILES, render_project


class IncrementalSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "project"
        shutil.copytree(ROOT / "examples" / "output" / "demo", self.root)
        render_project(self.root)
        self.assertTrue((self.root / "reviews" / "render-state.json").is_file())

    def tearDown(self):
        self.temp.cleanup()

    def snapshot(self, relatives):
        return {
            relative: ((self.root / relative).stat().st_mtime_ns, (self.root / relative).read_bytes())
            for relative in relatives
        }

    def test_noop_render_preserves_hash_and_mtime(self):
        relatives = [path for paths in ARTIFACT_FILES.values() for path in paths if (self.root / path).is_file() and "prototype" not in path]
        before = self.snapshot(relatives)
        render_project(self.root)
        self.assertEqual(before, self.snapshot(relatives))

    def test_manual_edit_conflicts_before_any_write_and_approval_is_logged(self):
        prd = self.root / "artifacts" / "prd.md"
        proposal = self.root / "artifacts" / "proposal.md"
        prd.write_text(prd.read_text(encoding="utf-8") + "\n<!-- HUMAN-MANUAL-EDIT -->\n", encoding="utf-8")
        proposal_mtime = proposal.stat().st_mtime_ns
        with self.assertRaises(ManualArtifactConflict):
            render_project(self.root)
        self.assertIn("HUMAN-MANUAL-EDIT", prd.read_text(encoding="utf-8"))
        self.assertEqual(proposal_mtime, proposal.stat().st_mtime_ns)
        render_project(self.root, only={"prd"}, approved_overwrites={"artifacts/prd.md"})
        self.assertNotIn("HUMAN-MANUAL-EDIT", prd.read_text(encoding="utf-8"))
        reviews = read_json(self.root / "reviews" / "review.json")
        self.assertTrue(any(record.get("action") == "artifact_overwrite_approved" and record.get("path") == "artifacts/prd.md" for record in reviews["records"]))

    def test_selective_schedule_render_does_not_touch_documents(self):
        plan_path = self.root / "models" / "delivery-plan.json"
        plan = read_json(plan_path)
        plan["items"][0]["title"] = "仅排期变化回归"
        write_json(plan_path, plan)
        relatives = ["artifacts/proposal.md", "artifacts/prd.md", "artifacts/agent-prompt.md", "artifacts/workbench/index.html"]
        before = self.snapshot(relatives)
        render_project(self.root, only={"schedule"})
        self.assertEqual(before, self.snapshot(relatives))
        self.assertIn("仅排期变化回归", (self.root / "artifacts" / "schedule" / "index.html").read_text(encoding="utf-8"))

    def test_dynamic_impact_includes_real_delivery_models(self):
        changes = {key: [] for key in ["added", "modified", "cancelled", "conflicted", "duplicated"]}
        changes["modified"].append({"requirement_id": "REQ-002", "changed_fields": ["acceptance_criteria"], "old": {}, "new": {}})
        artifacts, keys, details = analyze_impacts(changes, self.root)
        for key in ["technical_design", "schedule", "deck_brief", "prototype"]:
            self.assertIn(key, keys)
        for path in ["models/technical-design.json", "artifacts/schedule/index.html", "artifacts/deck-brief.md", "artifacts/prototype/index.html"]:
            self.assertIn(path, artifacts)
        self.assertEqual(details[0]["requirement_id"], "REQ-002")

    def test_render_module_has_no_unsafe_second_write_path(self):
        """Legacy renderers bypassed preflight; only the guarded path may remain."""
        source = (ROOT / "scripts" / "render_artifacts.py").read_text(encoding="utf-8")
        delivery = (ROOT / "scripts" / "delivery_render.py").read_text(encoding="utf-8")
        self.assertNotIn("atomic_write_text", source)
        self.assertNotIn("atomic_write_text", delivery)
        self.assertIn("preflight(root, targets, approved)", source)
        for removed in ("_render_project_legacy_static", "_render_project_branch_unsafe", "render_delivery_artifacts"):
            self.assertNotIn(removed, source)
            self.assertNotIn(removed, delivery)


if __name__ == "__main__":
    unittest.main()
