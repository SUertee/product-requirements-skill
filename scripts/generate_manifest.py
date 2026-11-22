#!/usr/bin/env python3
"""Record actual project files, versions, hashes and validation results."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

from project_lib import load_requirements, project_errors, read_json, read_optional_json, stable_id, utc_now, write_json


def artifact_type_for(relative):
    if "workbench/" in relative:
        return "workbench"
    if "prototype/" in relative:
        return "prototype"
    if "schedule/" in relative:
        return "schedule"
    if "deck/" in relative or "deck-handdrawn/" in relative:
        return "deck"
    if "diagrams/" in relative or "data-model/" in relative:
        return "diagram"
    if relative.endswith("changelog-v1.1.md") or relative.endswith("changelog.md"):
        return "review"
    if relative.endswith("agent-prompt.md"):
        return "agent_prompt"
    if relative.endswith("technical-design-full.md"):
        return "technical_design"
    if relative.endswith("proposal-full.md"):
        return "proposal"
    if relative.endswith("prd-full.md"):
        return "prd"
    if relative.endswith("technical-design.md"):
        return "technical_design"
    if relative.endswith("deck-brief.md"):
        return "deck_brief"
    if relative.endswith("prd.md"):
        return "prd"
    if relative.endswith("proposal.md"):
        return "proposal"
    return "business_model"


def delivery_trace(root, artifact_type, fallback):
    model_name, fields = {
        "technical_design": ("technical-design.json", ("decisions", "diagrams")),
        "diagram": ("technical-design.json", ("diagrams",)),
        "schedule": ("delivery-plan.json", ("items",)),
        "deck_brief": ("deck-brief.json", ("slides",)),
        "deck": ("deck-brief.json", ("slides",)),
    }.get(artifact_type, (None, ()))
    if not model_name:
        return fallback
    model = read_optional_json(root / "models" / model_name) or {}
    traced = sorted({req_id for field in fields for row in model.get(field, []) for req_id in row.get("requirement_ids", [])})
    return traced or fallback


def delivery_review_status(root, artifact_type, project, fallback):
    if artifact_type == "prototype" and project.get("current_baseline_id"):
        return "approved"
    model_name = {
        "technical_design": "technical-design.json", "diagram": "technical-design.json",
        "schedule": "delivery-plan.json", "deck_brief": "deck-brief.json", "deck": "deck-brief.json",
    }.get(artifact_type)
    if not model_name:
        return fallback
    model = read_optional_json(root / "models" / model_name) or {}
    status = model.get("review_status", model.get("status", fallback))
    if artifact_type == "deck" and model.get("export_status") != "exported":
        return "draft"
    return status if status in {"draft", "reviewed", "approved"} else fallback


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
            artifact_type = artifact_type_for(relative)
            artifacts.append({
                "schema_version": "1.0",
                "artifact_id": stable_id("ART-", project["project_id"], relative, project["current_version"]),
                "project_id": project["project_id"], "artifact_type": artifact_type,
                "artifact_path": relative, "version": project["current_version"],
                "requirement_ids": delivery_trace(root, artifact_type, prototype_req_ids if artifact_type == "prototype" else req_ids),
                "generation_status": "success",
                "review_status": delivery_review_status(root, artifact_type, project, "draft"),
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
