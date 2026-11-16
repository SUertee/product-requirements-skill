import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))
from project_lib import load_requirements, read_json


class DiffRequirementsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        demo = ROOT / "examples" / "output" / "demo"
        self.old = read_json(demo / "baselines" / "v1.0.json")["confirmed_requirements"][:3]
        self.assertEqual(len(self.old), 3)

    def tearDown(self):
        self.temp.cleanup()

    def test_five_change_categories_and_lock_protection(self):
        old = copy.deepcopy(self.old)
        old[0]["locked_by_human"] = False
        old[2]["locked_by_human"] = True
        new = copy.deepcopy(old[1:])
        new[0]["description"] = "普通修改"
        new[1]["description"] = "试图覆盖整条锁定"
        added = copy.deepcopy(old[0]); added["requirement_id"] = "REQ-900"; added["title"] = "独立新增需求"
        duplicate = copy.deepcopy(old[0]); duplicate["requirement_id"] = "REQ-901"; duplicate["title"] = new[0]["title"]
        new.extend([added, duplicate])
        old_path = self.root / "old.json"; new_path = self.root / "new.json"; output = self.root / "changeset.json"
        old_path.write_text(json.dumps({"baseline_id": "BASE-TEST", "confirmed_requirements": old}, ensure_ascii=False), encoding="utf-8")
        new_path.write_text(json.dumps({"requirements": new}, ensure_ascii=False), encoding="utf-8")
        subprocess.run([sys.executable, str(SCRIPTS / "diff_requirements.py"), "--old", str(old_path), "--new", str(new_path), "--output", str(output), "--source", "EVD-TEST"], check=True, capture_output=True, text=True)
        result = read_json(output)
        self.assertEqual(len(result["added"]), 1)
        self.assertEqual(len(result["modified"]), 1)
        self.assertEqual(len(result["cancelled"]), 1)
        self.assertEqual(len(result["conflicted"]), 1)
        self.assertEqual(len(result["duplicated"]), 1)
        self.assertEqual(result["review_status"], "draft")
        self.assertEqual(result["old_baseline_id"], "BASE-TEST")
        self.assertIn("artifacts/prd.md", result["impact_analysis"])


if __name__ == "__main__":
    unittest.main()
