#!/usr/bin/env python3
"""Locate configured skill entrypoints without executing third-party code."""
import argparse
import json
import os
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('capability', choices=['archify', 'schema-canvas'])
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
configuration = json.loads((root / 'integrations.json').read_text())
entry = configuration[args.capability]
repository = root.parents[1] if root.parent.name == 'skills' else root
default = repository.parent / 'skill-dependencies' / args.capability
if args.capability == 'archify':
    default = default / 'archify'
package = Path(os.environ.get(entry['environment_variable'], str(default))).expanduser().resolve()
if not (package / 'SKILL.md').is_file():
    parser.exit(1, f"Missing Skill entrypoint. Set {entry['environment_variable']} to its package directory.\n")
print(json.dumps({'capability': args.capability, 'entrypoint': str(package / 'SKILL.md')}, ensure_ascii=False))
