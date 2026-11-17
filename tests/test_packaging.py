"""Run an extracted Skill package through its normal CLI outside the source tree."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import wave
import zipfile

PACKAGE = Path(__file__).resolve().parents[1] / 'product-requirements'


class PackageTests(unittest.TestCase):
    def test_extracted_package_can_import_linked_media_and_build_workbench(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            archive_path = root / 'skill.zip'
            with zipfile.ZipFile(archive_path, 'w') as archive:
                for file in PACKAGE.rglob('*'):
                    if file.is_file() and '__pycache__' not in file.parts and not file.name.startswith('.'):
                        archive.write(file, Path(PACKAGE.name) / file.relative_to(PACKAGE))
            skills = root / '.codeartsdoer/skills'
            with zipfile.ZipFile(archive_path) as archive:
                archive.extractall(skills)
            package = skills / PACKAGE.name
            self.assertIn('name: ' + package.name, (package / 'SKILL.md').read_text())
            workspace = root / 'workspace'
            baseline = root / 'v0'

            def command(script, *arguments):
                result = subprocess.run([sys.executable, str(package / 'scripts' / script), *map(str, arguments)],
                                        cwd=root, capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, 0, result.stderr)
                return json.loads(result.stdout)

            command('workflow.py', '--workspace', workspace, 'init', '--project-id', 'portable', '--name', '打包验收', '--output', baseline)
            recording = root / 'recording.wav'
            with wave.open(str(recording), 'wb') as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(16000)
                audio.writeframes(b'\0\0' * 32000)
            transcript = root / 'recording.srt'
            transcript.write_text('1\n00:00:01,000 --> 00:00:01,500\n【合成】检查原话与录音关联。\n')
            audio_job = command('ingest_material.py', '--input', recording, '--workspace', workspace, '--project-id', 'portable')
            transcript_job = command('ingest_material.py', '--input', transcript, '--workspace', workspace, '--project-id', 'portable', '--related-job', audio_job['job_id'])
            task = command('workflow.py', '--workspace', workspace, 'prepare', '--run-dir', baseline, '--job', transcript_job['job_id'], '--version', 'v1')
            candidate = json.loads((baseline / 'project.json').read_text())
            candidate.update(artifact_version='v1', baseline_version='v0')
            candidate_path = root / 'candidate.json'
            candidate_path.write_text(json.dumps(candidate))
            completed = command('workflow.py', '--workspace', workspace, 'complete', '--request-id', task['id'], '--project', candidate_path)
            output = Path(completed['result_dir'])
            project = json.loads((output / 'project.json').read_text())
            self.assertEqual(len(project['materials']), 2)
            self.assertTrue((output / 'workbench/index.html').is_file())
            media = next(item for item in project['materials'] if item['kind'] == 'recording')
            self.assertEqual((output / 'materials' / media['path']).read_bytes(), recording.read_bytes())
