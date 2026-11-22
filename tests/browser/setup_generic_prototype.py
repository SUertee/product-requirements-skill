#!/usr/bin/env python3
"""Prepare a project whose prototype exercises exact matching and archive confirmation.

The standard demo uses ``contains`` matching and has no archive action. The CDP
prototype regression therefore needs this prepared copy; previously the setup
lived only in the gitignored ``runs/`` directory and could not be reproduced
from a clean checkout.
"""
import argparse
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from project_lib import read_json, write_json
from render_artifacts import render_project


def prepare(destination):
    target = Path(destination).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(ROOT / "examples" / "output" / "demo", target, dirs_exist_ok=True)
    project_path = target / "project.json"
    project = read_json(project_path)
    flow = project.setdefault("prototype_flow", {})
    flow["match_rule"] = "exact"
    flow["archive"] = True
    write_json(project_path, project)
    render_project(target, only={"prototype"})
    prototype = (target / "artifacts" / "prototype" / "index.html").read_text(encoding="utf-8")
    if '"match_rule": "exact"' not in prototype or '"type": "archive"' not in prototype:
        raise ValueError("Prepared prototype is missing exact matching or archive actions")
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="runs/generic-browser-project", help="Directory for the prepared project")
    args = parser.parse_args()
    target = prepare(args.output)
    # Plain path on stdout so it can be captured by shell command substitution.
    print(target / "artifacts" / "prototype" / "index.html")


if __name__ == "__main__":
    main()
