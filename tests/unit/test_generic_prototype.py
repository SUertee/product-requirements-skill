import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from project_lib import read_json
from prototype import build_prototype_data, build_prototype_pages, render_prototype


class GenericPrototypeTests(unittest.TestCase):
    def setUp(self):
        self.project = read_json(ROOT / "examples" / "output" / "demo" / "project.json")
        baseline = read_json(ROOT / "examples" / "output" / "demo" / "baselines" / "v1.1.json")
        self.confirmed = [item for item in baseline["confirmed_requirements"] if item["status"] == "confirmed"]
        self.project["prototype_flow"]["match_rule"] = "exact"
        self.project["prototype_flow"]["archive"] = True

    def test_legacy_flow_supports_match_rule_and_archive(self):
        data = build_prototype_data(self.project, self.confirmed)
        customer = next(page for page in data["pages"] if page["page_id"] == "customer-list")
        self.assertEqual(customer["query"]["match_rule"], "exact")
        self.assertTrue(any(action["type"] == "archive" for action in customer["row_actions"]))
        detail = next(page for page in data["pages"] if page["page_id"] == "customer-detail")
        self.assertEqual(detail["detail"]["sort"], "desc")
        self.assertTrue(any(action["type"] == "archive" for action in detail["actions"]))

    def test_explicit_pages_validate_navigation_targets(self):
        self.project["prototype_pages"] = [{
            "page_id": "one", "name": "页面", "requirement_ids": [], "fields": [],
            "actions": [{"type": "navigate", "target_page_id": "missing", "label": "无效目标"}],
        }]
        with self.assertRaisesRegex(ValueError, "unknown page"):
            build_prototype_pages(self.project, self.confirmed)

    def test_render_uses_generic_data_and_javascript_syntax(self):
        rendered = render_prototype(self.project, self.confirmed)
        self.assertIn('"match_rule": "exact"', rendered)
        self.assertIn('"type": "archive"', rendered)
        self.assertNotIn("item.name.toLowerCase().includes(name)", rendered)
        scripts = re.findall(r"<script>(.*?)</script>", rendered, re.DOTALL)
        node = shutil.which("node")
        if not node:
            self.skipTest("Node.js is not available")
        result = subprocess.run([node, "--check"], input=scripts[-1], text=True, encoding="utf-8", capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_browser_fixture_setup_is_reproducible_without_runs_dir(self):
        """The CDP check needs exact+archive; its setup must be tracked, not in runs/."""
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "prepared"
            result = subprocess.run(
                [sys.executable, str(ROOT / "tests" / "browser" / "setup_generic_prototype.py"), "--output", str(target)],
                cwd=ROOT, capture_output=True, text=True, timeout=60,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            prototype = Path(result.stdout.strip()).read_text(encoding="utf-8")
            self.assertIn('"match_rule": "exact"', prototype)
            self.assertIn('"type": "archive"', prototype)
            self.assertIn("archive-dialog", prototype)
            flow = read_json(target / "project.json")["prototype_flow"]
            self.assertEqual(flow["match_rule"], "exact")
            self.assertTrue(flow["archive"])


if __name__ == "__main__":
    unittest.main()
