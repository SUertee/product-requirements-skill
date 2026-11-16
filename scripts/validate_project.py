#!/usr/bin/env python3
"""Validate file structure, JSON Schema fields and cross-file project integrity."""
import argparse
import json
from pathlib import Path

from project_lib import SCHEMA_DIR, project_errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, type=Path)
    args = parser.parse_args()
    errors = []
    for schema_path in sorted(SCHEMA_DIR.glob("*.schema.json")):
        try:
            json.loads(schema_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            errors.append(f"{schema_path.name}: {error}")
    if not errors:
        try:
            errors = project_errors(args.project)
        except (OSError, ValueError, json.JSONDecodeError) as error:
            errors = [str(error)]
    print(json.dumps({"status": "passed" if not errors else "failed", "errors": errors}, ensure_ascii=False, indent=2))
    raise SystemExit(1 if errors else 0)


if __name__ == "__main__":
    main()
