#!/usr/bin/env python3
"""Validate Evidence to Source/Segment references and verbatim quotes."""
import argparse
import json
from pathlib import Path

from project_lib import evidence_errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, type=Path)
    args = parser.parse_args()
    try:
        errors = evidence_errors(args.project)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        errors = [str(error)]
    print(json.dumps({"status": "passed" if not errors else "failed", "errors": errors}, ensure_ascii=False, indent=2))
    raise SystemExit(1 if errors else 0)


if __name__ == "__main__":
    main()
