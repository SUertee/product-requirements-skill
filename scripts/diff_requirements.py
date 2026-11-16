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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--old", required=True, type=Path)
    parser.add_argument("--new", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--project-id")
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
    total = sum(len(items) for items in changes.values())
    changeset = {
        "schema_version": "1.0",
        "changeset_id": stable_id("CHANGE-", project_id, old_baseline or "draft", utc_now()),
        "project_id": project_id,
        "old_baseline_id": old_baseline or "BASE-DRAFT",
        "new_baseline_id": "BASE-PENDING",
        **changes,
        "impact_analysis": ["requirements/requirements.json", "artifacts/proposal.md", "artifacts/prd.md", "artifacts/workbench/index.html", "artifacts/prototype/index.html"] if total else [],
        "review_status": "draft",
        "created_at": utc_now(),
    }
    write_json(args.output, changeset)
    print(json.dumps({"changeset_id": changeset["changeset_id"], "counts": {key: len(value) for key, value in changes.items()}, "output": str(args.output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
