#!/usr/bin/env python3
"""Record actual project files, versions, hashes and validation results."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

from project_lib import load_requirements, project_errors, read_json, stable_id, utc_now, write_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, type=Path)
    args = parser.parse_args()
    root = args.project.resolve()
    project = read_json(root / "project.json")
    requirements = load_requirements(root)
    req_ids = [item["requirement_id"] for item in requirements]
    prototype_req_ids = req_ids
    baseline_path = root / "baselines" / f"{project['current_version']}.json"
    if baseline_path.is_file():
        baseline = read_json(baseline_path)
        prototype_req_ids = [item["requirement_id"] for item in baseline.get("confirmed_requirements", []) if item.get("status") == "confirmed"]
    files = []
    artifacts = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.name == "manifest.json" or any(part.startswith(".") for part in path.relative_to(root).parts):
            continue
        raw = path.read_bytes()
        relative = path.relative_to(root).as_posix()
        files.append({
            "path": relative, "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw),
            "updated_at": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat().replace("+00:00", "Z"),
        })
        if relative.startswith("artifacts/") and not relative.startswith("artifacts/versions/"):
            artifact_type = "workbench" if "workbench/" in relative else "prototype" if "prototype/" in relative else "agent_prompt" if relative.endswith("agent-prompt.md") else "prd" if relative.endswith("prd.md") else "proposal" if relative.endswith("proposal.md") else "business_model"
            artifacts.append({
                "schema_version": "1.0",
                "artifact_id": stable_id("ART-", project["project_id"], relative, project["current_version"]),
                "project_id": project["project_id"], "artifact_type": artifact_type,
                "artifact_path": relative, "version": project["current_version"],
                "requirement_ids": prototype_req_ids if artifact_type == "prototype" else req_ids,
                "generation_status": "success",
                "review_status": "approved" if artifact_type == "prototype" and project.get("current_baseline_id") else "draft",
                "created_at": utc_now(),
            })
    errors = project_errors(root)
    manifest = {
        "schema_version": "1.0", "project_id": project["project_id"],
        "artifact_version": project["current_version"], "baseline_id": project.get("current_baseline_id"),
        "generation_mode": project.get("generation_mode", "Agent + deterministic scripts"),
        "generated_at": utc_now(), "files": files, "artifacts": artifacts,
        "validation_results": {"status": "passed" if not errors else "failed", "errors": errors},
    }
    write_json(root / "manifest.json", manifest)
    print(json.dumps({"files": len(files), "artifacts": len(artifacts), "validation": manifest["validation_results"]["status"]}, ensure_ascii=False))
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
