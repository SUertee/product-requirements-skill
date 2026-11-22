#!/usr/bin/env python3
"""Locate configured skill entrypoints without executing third-party code."""
import argparse
import json
import os
from pathlib import Path

root = Path(__file__).resolve().parent.parent
configuration = json.loads((root / 'integrations.json').read_text(encoding='utf-8'))
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('capability', choices=sorted(configuration))
args = parser.parse_args()
entry = configuration[args.capability]
default = root.parent / 'skill-dependencies' / entry.get('dependency_directory', args.capability)
configured = Path(os.environ.get(entry['environment_variable'], str(default))).expanduser().resolve()
subdirectory = entry.get('skill_subdirectory', '')
package = configured / subdirectory
# Environment variables may point either to a repository root or directly to a
# Skill package. The latter preserves the original Archify integration contract.
if not (package / 'SKILL.md').is_file() and (configured / 'SKILL.md').is_file():
    package = configured
if not (package / 'SKILL.md').is_file():
    parser.exit(1, f"Missing Skill entrypoint. Set {entry['environment_variable']} to its repository or package directory.\n")
result = {'capability': args.capability, 'entrypoint': str(package / 'SKILL.md')}
for key in ('repository', 'commit', 'license'):
    if key in entry:
        result[key] = entry[key]
print(json.dumps(result, ensure_ascii=False))
