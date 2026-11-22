from html.parser import HTMLParser
import json
from pathlib import Path
import re
import shutil
import subprocess
import unittest
from urllib.parse import urldefrag

ROOT = Path(__file__).resolve().parents[2]
DEMO = ROOT / "examples" / "output" / "demo" / "artifacts"


def workbench_data():
    text = (DEMO / "workbench" / "index.html").read_text(encoding="utf-8")
    match = re.search(r'<script id="workbench-data" type="application/json">(.*?)</script>', text, re.DOTALL)
    if not match:
        raise AssertionError("Missing workbench Project Data")
    return json.loads(match.group(1))


class LocalLinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            href = dict(attrs).get("href")
            if href and not href.startswith(("#", "http://", "https://", "mailto:")):
                self.links.append(href)


class WorkbenchStaticTests(unittest.TestCase):
    def test_workbench_uses_branch_html_shell(self):
        """The feat/workflow-execution shell must remain the single template source."""
        shell = (ROOT / "assets" / "workbench-template.html").read_text(encoding="utf-8")
        for token in ("__WORKBENCH_STYLE__", "__WORKBENCH_DATA__", "__WORKBENCH_SCRIPT__"):
            self.assertIn(token, shell)
        for marker in ('class="workspace"', 'id="navigation"', 'id="page-content"',
                       'id="open-search"', 'id="toggle-sidebar"'):
            self.assertIn(marker, shell)
        rendered = (DEMO / "workbench" / "index.html").read_text(encoding="utf-8")
        self.assertNotIn("__WORKBENCH_", rendered)
        self.assertIn('class="workspace"', rendered)

    def test_workbench_inline_javascript_syntax(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("Node.js is not available for JavaScript syntax validation")
        workbench = (DEMO / "workbench" / "index.html").read_text(encoding="utf-8")
        match = re.search(r"<script>\s*(.*?)</script>", workbench, re.DOTALL)
        self.assertIsNotNone(match)
        result = subprocess.run([node, "--check"], input=match.group(1), text=True, encoding="utf-8", capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_deck_exporter_javascript_syntax(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("Node.js is not available for JavaScript syntax validation")
        result = subprocess.run(
            [node, "--check", str(ROOT / "scripts" / "export_deck_pptx.mjs")],
            text=True, encoding="utf-8", capture_output=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_review_checkbox_and_note_ids_match(self):
        workbench = (DEMO / "workbench" / "index.html").read_text(encoding="utf-8")
        self.assertIn("wb-review-check", workbench)
        self.assertIn("dataset.reqId", workbench)
        self.assertIn("dataset.reqNote", workbench)
        requirement_ids = sorted(item["requirement_id"] for item in workbench_data()["requirements"])
        self.assertEqual(requirement_ids, ["REQ-001", "REQ-002", "REQ-003", "REQ-004"])

    def test_generated_workbench_and_schedule_links_exist(self):
        artifacts = workbench_data()["artifacts"]
        self.assertTrue(artifacts)
        for item in artifacts:
            self.assertTrue((DEMO.parent / item["path"]).is_file(), f"Broken workbench artifact: {item['path']}")
        page = DEMO / "schedule" / "index.html"
        parser = LocalLinkParser()
        parser.feed(page.read_text(encoding="utf-8"))
        self.assertTrue(parser.links, "No local links found in schedule")
        for href in parser.links:
            target = (page.parent / urldefrag(href).url).resolve()
            self.assertTrue(target.exists(), f"Broken link in schedule: {href}")


if __name__ == "__main__":
    unittest.main()
