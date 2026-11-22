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
    def test_changeset_ids_are_content_stable_and_distinct(self):
        old_path = self.root / "old.json"
        old_path.write_text(json.dumps({"baseline_id": "BASE-TEST", "confirmed_requirements": self.old}, ensure_ascii=False), encoding="utf-8")
        outputs = []
        for label, description in [("one", "第一种修改"), ("two", "第二种修改"), ("repeat", "第一种修改")]:
            new = copy.deepcopy(self.old)
            new[0]["description"] = description
            new_path = self.root / f"new-{label}.json"
            new_path.write_text(json.dumps({"requirements": new}, ensure_ascii=False), encoding="utf-8")
            output = self.root / f"changeset-{label}.json"
            subprocess.run([sys.executable, str(SCRIPTS / "diff_requirements.py"), "--old", str(old_path), "--new", str(new_path), "--output", str(output), "--project-id", "demo"], check=True, capture_output=True, text=True)
            outputs.append(read_json(output)["changeset_id"])
        self.assertNotEqual(outputs[0], outputs[1])
        self.assertEqual(outputs[0], outputs[2])

    def test_changeset_id_ignores_generation_timestamps_and_uses_baseline(self):
        """A rerun of the same semantic diff must not get a new ID because of metadata."""
        ids = []

        def changeset_id(old_baseline, new_requirements, stamp):
            source = self.root / "old-stamped.json"
            source.write_text(json.dumps({"baseline_id": old_baseline, "confirmed_requirements": [
                {**item, "created_at": stamp, "updated_at": stamp} for item in self.old
            ]}, ensure_ascii=False), encoding="utf-8")
            candidate = self.root / "new-stamped.json"
            new = copy.deepcopy(new_requirements)
            for item in new:
                item["created_at"] = stamp
                item["updated_at"] = stamp
            candidate.write_text(json.dumps({"requirements": new}, ensure_ascii=False), encoding="utf-8")
            output = self.root / "out.json"
            subprocess.run([sys.executable, str(SCRIPTS / "diff_requirements.py"), "--old", str(source), "--new", str(candidate), "--output", str(output), "--project-id", "demo"], check=True, capture_output=True, text=True)
            return read_json(output)["changeset_id"]

        modified = copy.deepcopy(self.old)
        modified[0]["description"] = "语义变更"
        ids.append(changeset_id("BASE-TEST", modified, "2026-01-01T00:00:00Z"))
        ids.append(changeset_id("BASE-TEST", modified, "2026-11-22T14:00:00Z"))
        self.assertEqual(ids[0], ids[1])
        # A different old baseline is a different comparison, so IDs must differ.
        ids.append(changeset_id("BASE-OTHER", modified, "2026-11-22T14:00:00Z"))
        self.assertNotEqual(ids[0], ids[2])
        # A genuinely different edit is a different change, so IDs must differ.
        other = copy.deepcopy(self.old)
        other[0]["description"] = "另一种语义变更"
        ids.append(changeset_id("BASE-TEST", other, "2026-11-22T14:00:00Z"))
        self.assertNotEqual(ids[0], ids[3])


if __name__ == "__main__":
    unittest.main()
