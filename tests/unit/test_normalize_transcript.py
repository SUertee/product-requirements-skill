import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from normalize_transcript import normalize, segments
from project_lib import atomic_write_text

FIXTURES = ROOT / "tests" / "fixtures"


class NormalizeTranscriptTests(unittest.TestCase):
    def test_txt_paragraphs_hash_and_original_text(self):
        material, rows = normalize(FIXTURES / "meeting.txt", "demo")
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["paragraph"], 1)
        self.assertEqual(rows[0]["start_time"], None)
        self.assertIn("客户提出", rows[0]["original_text"])
        self.assertEqual(material["file_hash"], hashlib.sha256((FIXTURES / "meeting.txt").read_bytes()).hexdigest())
        self.assertTrue(material["source_id"].startswith("SRC-"))
        self.assertTrue(rows[0]["segment_id"].startswith("SEG-"))
        self.assertNotEqual(material["source_id"], rows[0]["segment_id"])

    def test_markdown_uses_same_paragraph_contract(self):
        material, rows = normalize(FIXTURES / "meeting.md", "demo")
        self.assertEqual(len(rows), 3)
        self.assertEqual(material["file_name"], "meeting.md")

    def test_srt_and_vtt_timing(self):
        for name in ["meeting.srt", "meeting.vtt"]:
            with self.subTest(name=name):
                _, rows = normalize(FIXTURES / name, "demo")
                self.assertEqual(len(rows), 2)
                self.assertEqual(rows[0]["start_time"], 1.0)
                self.assertEqual(rows[0]["end_time"], 4.5)
                self.assertEqual(rows[1]["speaker_id"], "Speaker B")

    def test_repeat_has_stable_ids(self):
        first_material, first = normalize(FIXTURES / "meeting.srt", "demo")
        second_material, second = normalize(FIXTURES / "meeting.srt", "demo")
        self.assertEqual(first_material["source_id"], second_material["source_id"])
        self.assertEqual([row["segment_id"] for row in first], [row["segment_id"] for row in second])

    def test_invalid_and_empty(self):
        with self.assertRaisesRegex(ValueError, "ends before it starts"):
            normalize(FIXTURES / "invalid_timestamp.srt", "demo")
        with tempfile.TemporaryDirectory() as temporary:
            empty = Path(temporary) / "empty.txt"
            empty.write_text("", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "no transcript segments"):
                normalize(empty, "demo")

    def test_atomic_replace_failure_preserves_old_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "project.json"
            target.write_text("old", encoding="utf-8")
            with mock.patch("project_lib.os.replace", side_effect=OSError("simulated replace failure")):
                with self.assertRaises(OSError):
                    atomic_write_text(target, "new")
            self.assertEqual(target.read_text(encoding="utf-8"), "old")
            self.assertFalse(list(Path(temporary).glob("*.tmp")))


if __name__ == "__main__":
    unittest.main()
