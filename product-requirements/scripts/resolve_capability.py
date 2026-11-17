#!/usr/bin/env python3
"""Locate configured skill entrypoints without executing third-party code."""
import argparse
import json
import os
from pathlib import Path


def resolve(capability):
    root = Path(__file__).resolve().parent.parent
    configuration = json.loads((root / 'integrations.json').read_text())
    entry = configuration[capability]
    default = root.parent.parent / 'skill-dependencies' / capability
    if capability == 'archify':
        default = default / 'archify'
    configured = os.environ.get(entry['environment_variable'])
    candidates = [Path(configured).expanduser()] if configured else [
        root.parent / capability,
        default,
        Path.home() / '.codeartsdoer' / 'skills' / capability,
    ]
    for candidate in candidates:
        package = candidate.resolve()
        if (package / 'SKILL.md').is_file():
            return package
    raise ValueError(f"Missing Skill entrypoint. Set {entry['environment_variable']} to its package directory.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('capability', choices=['archify', 'schema-canvas'])
    args = parser.parse_args()
    try:
        package = resolve(args.capability)
        print(json.dumps({'capability': args.capability, 'entrypoint': str(package / 'SKILL.md')}, ensure_ascii=False))
    except (OSError, ValueError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
