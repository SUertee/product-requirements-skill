"""Verify the distributable Skill zip is clean, deterministic and runnable."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"
PACKAGE_NAME = "product-requirements-skill"
FORBIDDEN = ("__pycache__", ".pyc", "node_modules/", "/runs/", "/.git/", "/examples/output/", "/dist/")


class PackageSkillTests(unittest.TestCase):
    def test_package_is_clean_deterministic_and_self_contained(self):
        with tempfile.TemporaryDirectory() as temporary:
            temp = Path(temporary).resolve()
            first = temp / "skill.zip"
            second = temp / "skill-again.zip"
            for output in (first, second):
                result = subprocess.run(
                    [sys.executable, str(SCRIPTS / "package_skill.py"), "--output", str(output)],
                    cwd=ROOT, capture_output=True, text=True, timeout=60,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(result.stdout)["status"], "packaged")
            self.assertEqual(first.read_bytes(), second.read_bytes(), "zip build must be byte-reproducible")

            with zipfile.ZipFile(first) as archive:
                names = archive.namelist()
                self.assertTrue(names)
                self.assertTrue(all(name.startswith(PACKAGE_NAME + "/") for name in names))
                for token in FORBIDDEN:
                    self.assertFalse(any(token in name for name in names), f"junk in package: {token}")
                required = [
                    f"{PACKAGE_NAME}/SKILL.md",
                    f"{PACKAGE_NAME}/PACKAGE_MANIFEST.json",
                    f"{PACKAGE_NAME}/assets/workbench-template.html",
                    f"{PACKAGE_NAME}/assets/workbench.js",
                    f"{PACKAGE_NAME}/scripts/render_artifacts.py",
                ]
                for name in required:
                    self.assertIn(name, names)
                manifest = json.loads(archive.read(f"{PACKAGE_NAME}/PACKAGE_MANIFEST.json"))
                self.assertEqual(manifest["name"], PACKAGE_NAME)
                self.assertEqual(manifest["entrypoint"], "SKILL.md")
                archive.extractall(temp / "skills")

            package = temp / "skills" / PACKAGE_NAME
            skill = (package / "SKILL.md").read_text(encoding="utf-8")
            self.assertIn("name: " + PACKAGE_NAME, skill)
            for script in ("normalize_transcript.py", "render_artifacts.py", "diff_requirements.py", "generate_manifest.py", "validate_project.py"):
                result = subprocess.run(
                    [sys.executable, str(package / "scripts" / script), "--help"],
                    cwd=package, capture_output=True, text=True, timeout=30,
                )
                self.assertEqual(result.returncode, 0, f"{script}: {result.stderr}")

            demo = temp / "demo"
            result = subprocess.run(
                [sys.executable, str(package / "scripts" / "run_demo.py"), "--output", str(demo)],
                cwd=package, capture_output=True, text=True, timeout=120,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((demo / "artifacts" / "workbench" / "index.html").is_file())
            self.assertTrue((demo / "artifacts" / "prototype" / "index.html").is_file())
            self.assertTrue((demo / "reviews" / "render-state.json").is_file())

            result = subprocess.run(
                [sys.executable, str(package / "scripts" / "run_evals.py")],
                cwd=package, capture_output=True, text=True, timeout=180,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout.splitlines()[-1])["status"], "passed")


if __name__ == "__main__":
    unittest.main()
