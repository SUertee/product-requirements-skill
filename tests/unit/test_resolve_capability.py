import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "resolve_capability.py"


class ResolveCapabilityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def run_resolver(self, capability, variable, target):
        env = os.environ.copy()
        env[variable] = str(target)
        return subprocess.run(
            [sys.executable, str(SCRIPT), capability], env=env,
            capture_output=True, text=True,
        )

    def test_repository_subdirectory_is_resolved_with_pinned_metadata(self):
        entrypoint = self.root / "skills" / "code-to-diagram" / "SKILL.md"
        entrypoint.parent.mkdir(parents=True)
        entrypoint.write_text("---\nname: code-to-diagram\n---\n", encoding="utf-8")
        result = self.run_resolver("code-to-diagram", "CODE_TO_DIAGRAM_SKILL_DIR", self.root)
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(Path(payload["entrypoint"]), entrypoint.resolve())
        self.assertEqual(payload["commit"], "0ab6520f648f46aaaab918d5d6dc3c948cf0877a")
        self.assertEqual(payload["license"], "MIT")

    def test_direct_package_path_preserves_existing_archify_contract(self):
        entrypoint = self.root / "SKILL.md"
        entrypoint.write_text("---\nname: archify\n---\n", encoding="utf-8")
        result = self.run_resolver("archify", "ARCHIFY_SKILL_DIR", self.root)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(Path(json.loads(result.stdout)["entrypoint"]), entrypoint.resolve())

    def test_missing_dependency_reports_environment_variable(self):
        result = self.run_resolver("huashu-design", "HUASHU_DESIGN_SKILL_DIR", self.root / "missing")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("HUASHU_DESIGN_SKILL_DIR", result.stderr)
        self.assertNotIn("entrypoint", result.stdout)

    def test_all_configured_capabilities_are_cli_choices(self):
        configuration = json.loads((ROOT / "integrations.json").read_text(encoding="utf-8"))
        result = subprocess.run([sys.executable, str(SCRIPT), "--help"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        for capability in ["requirements-analysis", "pm-create-prd", "code-to-diagram", "huashu-design"]:
            self.assertIn(capability, result.stdout)
            self.assertIn("environment_variable", configuration[capability])


if __name__ == "__main__":
    unittest.main()
