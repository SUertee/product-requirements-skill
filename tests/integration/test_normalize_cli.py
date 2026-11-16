import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "normalize_transcript.py"
FIXTURES = ROOT / "tests" / "fixtures"


class NormalizeCliTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def run_cli(self, fixture, name="transcript.jsonl", sources=True):
        output = self.root / name
        command = [sys.executable, str(SCRIPT), "--input", str(FIXTURES / fixture), "--project-id", "demo", "--output", str(output)]
        if sources:
            command += ["--sources-output", str(self.root / "sources.jsonl")]
        return subprocess.run(command, capture_output=True, text=True), output

    def test_complete_cli_and_jsonl(self):
        result, output = self.run_cli("meeting.srt")
        self.assertEqual(result.returncode, 0, result.stderr)
        summary = json.loads(result.stdout)
        self.assertEqual(summary["segments"], 2)
        rows = [json.loads(line) for line in output.read_text(encoding="utf-8").splitlines()]
        self.assertEqual(rows[0]["start_time"], 1.0)
        self.assertEqual(rows[0]["speaker_id"], "Speaker A")
        source = json.loads((self.root / "sources.jsonl").read_text(encoding="utf-8"))
        self.assertEqual(len(source["file_hash"]), 64)
        self.assertFalse(list(self.root.glob("*.tmp")))

    def test_repeat_input_has_same_hash_and_stable_ids(self):
        first, first_output = self.run_cli("meeting.txt", "first.jsonl")
        second, second_output = self.run_cli("meeting.txt", "second.jsonl")
        self.assertEqual(first.returncode, second.returncode, 0)
        self.assertEqual(first_output.read_text(encoding="utf-8"), second_output.read_text(encoding="utf-8"))
        self.assertEqual(json.loads(first.stdout)["file_hash"], json.loads(second.stdout)["file_hash"])

    def test_invalid_timestamp_empty_and_unsupported(self):
        invalid, _ = self.run_cli("invalid_timestamp.srt")
        self.assertNotEqual(invalid.returncode, 0)
        self.assertIn("ends before it starts", invalid.stderr)
        empty = FIXTURES / "empty.txt"
        empty.write_text("", encoding="utf-8")
        try:
            empty_result, _ = self.run_cli("empty.txt")
            self.assertNotEqual(empty_result.returncode, 0)
            self.assertIn("no transcript segments", empty_result.stderr)
        finally:
            empty.unlink()
        unsupported = self.root / "meeting.mp3"
        unsupported.write_bytes(b"not audio")
        result = subprocess.run([sys.executable, str(SCRIPT), "--input", str(unsupported), "--project-id", "demo", "--output", str(self.root / "x.jsonl")], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("supported inputs", result.stderr)


if __name__ == "__main__":
    unittest.main()
