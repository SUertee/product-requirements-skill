"""Dependency lookup for repository development and host-installed Skill packages."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'product-requirements/scripts'))
import resolve_capability


class CapabilityLookupTests(unittest.TestCase):
    def test_host_sibling_skill_and_explicit_override(self):
        with tempfile.TemporaryDirectory() as directory:
            skills = Path(directory) / '.codeartsdoer/skills'
            root = skills / 'product-requirements'
            script = root / 'scripts/resolve_capability.py'
            script.parent.mkdir(parents=True)
            (root / 'integrations.json').write_text(json.dumps({'archify': {'environment_variable': 'ARCHIFY_SKILL_DIR'}}))
            dependency = skills / 'archify'
            dependency.mkdir()
            (dependency / 'SKILL.md').write_text('fixture')
            with patch.object(resolve_capability, '__file__', str(script)), patch.dict('os.environ', {}, clear=True):
                self.assertEqual(resolve_capability.resolve('archify'), dependency.resolve())
                with patch.dict('os.environ', {'ARCHIFY_SKILL_DIR': str(skills / 'missing')}):
                    with self.assertRaisesRegex(ValueError, 'ARCHIFY_SKILL_DIR'):
                        resolve_capability.resolve('archify')
