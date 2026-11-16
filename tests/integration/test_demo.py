import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from run_demo import run_demo
from run_evals import check_demo


class DemoIntegrationTests(unittest.TestCase):
    def test_fresh_demo_matches_expected_content(self):
        expectations = json.loads((ROOT / "examples" / "expected-output" / "expectations.json").read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as temporary:
            root = run_demo(Path(temporary) / "project")
            check_demo(root, expectations)
            for command in ["validate_evidence.py", "validate_project.py"]:
                result = subprocess.run([sys.executable, str(ROOT / "scripts" / command), "--project", str(root)], capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            with self.assertRaisesRegex(ValueError, "already exists"):
                run_demo(root)


if __name__ == "__main__":
    unittest.main()
