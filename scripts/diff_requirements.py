#!/usr/bin/env python3
"""Compare requirement versions and create a reviewable five-category ChangeSet."""
import argparse
import copy
import json
from pathlib import Path
import re

from project_lib import locked_changes, read_json, stable_id, utc_now, write_json


def load_list(path):
    value = read_json(path)
    if isinstance(value, list):
        return value, None
    if "confirmed_requirements" in value:
        return value["confirmed_requirements"], value.get("baseline_id")
    return value.get("requirements", []), value.get("baseline_id")


def title_key(requirement):
    return re.sub(r"\s+", "", requirement.get("title", "")).lower()


RENDER_ORDER = ["proposal", "prd", "agent_prompt", "workbench", "technical_design", "schedule", "deck_brief", "prototype"]
METADATA_FIELDS = {"updated_at", "version", "evidence_ids", "evidence_level", "locked_fields", "locked_by_human", "pending_questions"}
# Generation-time metadata must not enter the ChangeSet identity. Otherwise the
# same semantic diff rerun one second later gets a different ID, which defeats
# content addressing and makes every regenerated demo look like a new change.
VOLATILE_ID_FIELDS = {
    "created_at", "updated_at", "generated_at", "confirmed_at", "reviewed_at",
    "normalized_at", "at", "timestamp", "sha256",
}


def normalized_identity(value):
    """Drop generation-time metadata recursively while preserving semantic fields."""
    if isinstance(value, dict):
        return {key: normalized_identity(item) for key, item in sorted(value.items()) if key not in VOLATILE_ID_FIELDS}
    if isinstance(value, list):
        return [normalized_identity(item) for item in value]
    return value


def analyze_impacts(changes, project_dir=None):
    """Calculate review/regeneration impacts from changed fields and real models."""
    root = Path(project_dir) if project_dir else None
    records = [record for key in ("added", "modified", "cancelled", "conflicted") for record in changes[key]]
    if not records and not changes["duplicated"]:
        return [], [], []
    base = {"requirements/requirements.json", "artifacts/proposal.md", "artifacts/prd.md", "artifacts/workbench/index.html", "artifacts/agent-prompt.md"}
    for optional in ("artifacts/proposal-full.md", "artifacts/prd-full.md"):
        if root and (root / optional).is_file():
            base.add(optional)
    keys = {"proposal", "prd", "agent_prompt", "workbench"}
    details = []
    technical = read_json(root / "models" / "technical-design.json") if root and (root / "models" / "technical-design.json").is_file() else None
    plan = read_json(root / "models" / "delivery-plan.json") if root and (root / "models" / "delivery-plan.json").is_file() else None
    brief = read_json(root / "models" / "deck-brief.json") if root and (root / "models" / "deck-brief.json").is_file() else None

    def references(model, req_id, fields):
        if model is None:
            return False
        if model is technical:
            rows = model.get("decisions", []) + model.get("diagrams", [])
        elif model is plan:
            rows = model.get("items", [])
        else:
            rows = model.get("slides", [])
        return any(req_id in row.get("requirement_ids", []) for row in rows)

    for record in records:
        new = record.get("new") or {}
        old = record.get("old") or {}
        req_id = record.get("requirement_id") or new.get("requirement_id") or old.get("requirement_id")
        fields = set(record.get("changed_fields", [])) or set(new) or set(old)
        behavioral = fields - METADATA_FIELDS
        affected = set(base)
        record_keys = set(keys)
        if behavioral:
            keys.add("prototype")
            record_keys.add("prototype")
            affected.add("artifacts/prototype/index.html")
        is_added = record in changes["added"]
        if technical and (is_added or references(technical, req_id, fields)) and behavioral:
            keys.add("technical_design")
            record_keys.add("technical_design")
            affected.update({"models/technical-design.json", "artifacts/technical-design.md"})
            if root and (root / "artifacts" / "technical-design-full.md").is_file():
                affected.add("artifacts/technical-design-full.md")
        if plan and (is_added or references(plan, req_id, fields) or fields & {"priority", "scope", "dependencies"}):
            keys.add("schedule")
            record_keys.add("schedule")
            affected.update({"models/delivery-plan.json", "artifacts/schedule/index.html"})
        if brief and (is_added or references(brief, req_id, fields) or fields & {"priority", "scope", "dependencies"}):
            keys.add("deck_brief")
            record_keys.add("deck_brief")
            affected.update({"models/deck-brief.json", "artifacts/deck-brief.md"})
            affected.update(brief.get("output_paths", []))
        details.append({"requirement_id": req_id, "changed_fields": sorted(fields), "artifacts": sorted(affected), "render_keys": [key for key in RENDER_ORDER if key in record_keys]})
    if changes["duplicated"]:
        details.append({"requirement_id": None, "change_type": "duplicated", "artifacts": sorted(base), "render_keys": [key for key in RENDER_ORDER if key in keys]})
    all_artifacts = sorted({path for detail in details for path in detail["artifacts"]} or base)
    return all_artifacts, [key for key in RENDER_ORDER if key in keys], details


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--old", required=True, type=Path)
    parser.add_argument("--new", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--project-id")
    parser.add_argument("--project", type=Path, help="Project directory used to calculate model/artifact impacts; inferred from a changesets output when possible")
    parser.add_argument("--source", default="TBD")
    args = parser.parse_args()
    old_list, old_baseline = load_list(args.old)
    new_list, _ = load_list(args.new)
    old = {item["requirement_id"]: item for item in old_list}
    new = {item["requirement_id"]: item for item in new_list}
    if len(old) != len(old_list) or len(new) != len(new_list):
        parser.exit(1, "Duplicate REQ IDs in input\n")
    changes = {key: [] for key in ["added", "modified", "cancelled", "conflicted", "duplicated"]}
    ignored = {"updated_at", "version"}
    for requirement_id, candidate in new.items():
        previous = old.get(requirement_id)
        if not previous:
            duplicate_of = next((old_id for old_id, item in old.items() if title_key(item) == title_key(candidate)), None)
            if duplicate_of:
                changes["duplicated"].append({"requirement_id": requirement_id, "duplicate_of": duplicate_of, "new": candidate, "source": args.source})
            else:
                changes["added"].append({"new": candidate, "source": args.source})
            continue
        changed_fields = sorted(key for key in set(previous) | set(candidate) if key not in ignored and previous.get(key) != candidate.get(key))
        if not changed_fields:
            continue
        protected = locked_changes(previous, candidate)
        record = {"requirement_id": requirement_id, "old": previous, "new": candidate, "changed_fields": changed_fields, "source": args.source}
        if protected:
            record["locked_fields"] = protected
            changes["conflicted"].append(record)
        elif candidate.get("change_type") == "cancelled" or candidate.get("status") == "cancelled":
            changes["cancelled"].append(record)
        else:
            changes["modified"].append(record)
    for requirement_id, previous in old.items():
        if requirement_id not in new:
            changes["cancelled"].append({"requirement_id": requirement_id, "old": previous, "source": args.source})
    seen_titles = {}
    for candidate in new_list:
        key = title_key(candidate)
        if key in seen_titles:
            changes["duplicated"].append({"requirement_id": candidate["requirement_id"], "duplicate_of": seen_titles[key], "new": candidate, "source": args.source})
        else:
            seen_titles[key] = candidate["requirement_id"]
    unique_duplicates = {}
    for record in changes["duplicated"]:
        key = (record.get("requirement_id"), record.get("duplicate_of"))
        unique_duplicates[key] = record
    changes["duplicated"] = list(unique_duplicates.values())
    project_id = args.project_id or (new_list[0].get("project_id") if new_list else old_list[0].get("project_id"))
    project_root = args.project or (args.output.parent.parent if args.output.parent.name == "changesets" else None)
    impact_analysis, render_keys, impact_details = analyze_impacts(changes, project_root)
    identity = json.dumps(
        {"old_baseline_id": old_baseline or "draft", "changes": normalized_identity(changes)},
        ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    )
    changeset = {
        "schema_version": "1.0",
        "changeset_id": stable_id("CHANGE-", project_id, identity),
        "project_id": project_id,
        "old_baseline_id": old_baseline or "BASE-DRAFT",
        "new_baseline_id": "BASE-PENDING",
        **changes,
        "impact_analysis": impact_analysis,
        "render_keys": render_keys,
        "impact_details": impact_details,
        "review_status": "draft",
        "created_at": utc_now(),
    }
    write_json(args.output, changeset)
    print(json.dumps({"changeset_id": changeset["changeset_id"], "counts": {key: len(value) for key, value in changes.items()}, "render_keys": render_keys, "output": str(args.output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
