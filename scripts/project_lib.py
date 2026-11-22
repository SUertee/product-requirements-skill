#!/usr/bin/env python3
"""Shared standard-library helpers for file-backed Skill project data."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from zipfile import BadZipFile, ZipFile
from datetime import date, datetime, timezone

SKILL_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_DIR = SKILL_ROOT / "schemas"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def stable_id(prefix: str, *parts: object, length: int = 20) -> str:
    identity = "\0".join(str(part) for part in parts)
    return prefix + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:length]


def atomic_write_text(path: str | Path, content: str) -> None:
    """Write completely, close the descriptor, then atomically replace path."""
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor = None
    temporary = None
    try:
        descriptor, name = tempfile.mkstemp(
            prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent
        )
        temporary = Path(name)
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as output:
            descriptor = None
            output.write(content)
        os.replace(temporary, destination)
        temporary = None
    finally:
        if descriptor is not None:
            os.close(descriptor)
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def write_json(path: str | Path, value: object) -> None:
    atomic_write_text(path, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def read_json(path: str | Path) -> object:
    with Path(path).open("r", encoding="utf-8-sig") as source:
        return json.load(source)


def read_jsonl(path: str | Path) -> list[dict]:
    rows = []
    with Path(path).open("r", encoding="utf-8-sig") as source:
        for line_number, line in enumerate(source, 1):
            if line.strip():
                value = json.loads(line)
                if not isinstance(value, dict):
                    raise ValueError(f"{path}:{line_number}: JSONL row must be an object")
                rows.append(value)
    return rows


def write_jsonl(path: str | Path, rows: list[dict]) -> None:
    content = "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
    atomic_write_text(path, content)


def _type_matches(value: object, expected: str) -> bool:
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "string":
        return isinstance(value, str)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "null":
        return value is None
    return True


def validate_schema(value: object, schema: dict, location: str = "$", schema_dir: Path = SCHEMA_DIR) -> list[str]:
    """Validate the documented, project-used JSON Schema subset."""
    errors: list[str] = []
    if "$ref" in schema:
        reference = schema["$ref"]
        if reference.startswith("#/"):
            target = schema
            for part in reference[2:].split("/"):
                target = target[part]
            return validate_schema(value, target, location, schema_dir)
        referenced = json.loads((schema_dir / reference).read_text(encoding="utf-8"))
        return validate_schema(value, referenced, location, schema_dir)
    expected = schema.get("type")
    if expected:
        choices = expected if isinstance(expected, list) else [expected]
        if not any(_type_matches(value, choice) for choice in choices):
            return [f"{location}: expected type {expected}"]
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{location}: value {value!r} is not in {schema['enum']}")
    if isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            errors.append(f"{location}: shorter than minLength {schema['minLength']}")
        if "pattern" in schema and not re.search(schema["pattern"], value):
            errors.append(f"{location}: value does not match {schema['pattern']}")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            errors.append(f"{location}: below minimum {schema['minimum']}")
        if "maximum" in schema and value > schema["maximum"]:
            errors.append(f"{location}: above maximum {schema['maximum']}")
    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            errors.append(f"{location}: fewer than minItems {schema['minItems']}")
        if schema.get("uniqueItems"):
            serialized = [json.dumps(item, ensure_ascii=False, sort_keys=True) for item in value]
            if len(serialized) != len(set(serialized)):
                errors.append(f"{location}: items are not unique")
        if "items" in schema:
            for index, item in enumerate(value):
                errors.extend(validate_schema(item, schema["items"], f"{location}[{index}]", schema_dir))
    if isinstance(value, dict):
        for key in schema.get("required", []):
            if key not in value:
                errors.append(f"{location}: missing required property {key}")
        for key, child_schema in schema.get("properties", {}).items():
            if key in value:
                errors.extend(validate_schema(value[key], child_schema, f"{location}.{key}", schema_dir))
    return errors


def schema_errors(value: object, schema_name: str, location: str = "$") -> list[str]:
    schema = json.loads((SCHEMA_DIR / schema_name).read_text(encoding="utf-8"))
    return validate_schema(value, schema, location)


def load_requirements(project_dir: str | Path) -> list[dict]:
    value = read_json(Path(project_dir) / "requirements" / "requirements.json")
    if isinstance(value, list):  # legacy input
        return value
    return value.get("requirements", [])


def requirement_container(project_id: str, requirements: list[dict]) -> dict:
    return {"schema_version": "1.0", "project_id": project_id, "requirements": requirements}


def next_requirement_id(requirements: list[dict]) -> str:
    numbers = []
    for requirement in requirements:
        match = re.fullmatch(r"REQ-(\d+)", requirement.get("requirement_id", ""))
        if match:
            numbers.append(int(match.group(1)))
    return f"REQ-{max(numbers, default=0) + 1:03d}"


def locked_changes(old: dict, new: dict) -> list[str]:
    ignored = {"updated_at"}
    if old.get("locked_by_human"):
        return sorted(key for key in set(old) | set(new) if key not in ignored and old.get(key) != new.get(key))
    return sorted(
        field for field in old.get("locked_fields", [])
        if old.get(field) != new.get(field)
    )


def evidence_errors(project_dir: str | Path) -> list[str]:
    root = Path(project_dir)
    evidence_path = root / "evidence" / "evidence.jsonl"
    transcript_path = root / "sources" / "transcript.jsonl"
    if not evidence_path.exists():
        return ["missing evidence/evidence.jsonl"]
    if not transcript_path.exists():
        return ["missing sources/transcript.jsonl"]
    segments = read_jsonl(transcript_path)
    by_id = {segment.get("segment_id"): segment for segment in segments}
    sources_path = root / "sources" / "sources.jsonl"
    source_ids = {row.get("source_id") for row in read_jsonl(sources_path)} if sources_path.exists() else set()
    errors: list[str] = []
    evidence_ids: set[str] = set()
    for index, evidence in enumerate(read_jsonl(evidence_path)):
        location = f"evidence[{index}]"
        errors.extend(schema_errors(evidence, "evidence.schema.json", location))
        evidence_id = evidence.get("evidence_id")
        if evidence_id in evidence_ids:
            errors.append(f"{location}: duplicate evidence_id {evidence_id}")
        evidence_ids.add(evidence_id)
        segment = by_id.get(evidence.get("segment_id"))
        if not segment:
            errors.append(f"{location}: segment_id does not exist: {evidence.get('segment_id')}")
            continue
        if evidence.get("source_id") != segment.get("source_id"):
            errors.append(f"{location}: source_id does not match its segment")
        if source_ids and evidence.get("source_id") not in source_ids:
            errors.append(f"{location}: source_id does not exist")
        quote = evidence.get("original_quote", "")
        if quote not in segment.get("original_text", ""):
            errors.append(f"{location}: original_quote is not a verbatim substring of the segment")
        start, end = evidence.get("start_time"), evidence.get("end_time")
        if start is not None and end is not None and end < start:
            errors.append(f"{location}: end_time precedes start_time")
        if start != segment.get("start_time") or end != segment.get("end_time"):
            errors.append(f"{location}: evidence timestamps must match the segment")
        if evidence.get("evidence_level") == "E1" and evidence.get("is_inferred"):
            errors.append(f"{location}: inferred content cannot be E1")
    return errors


def read_optional_json(path: str | Path) -> object | None:
    """Read an optional model without changing legacy project requirements."""
    source = Path(path)
    return read_json(source) if source.is_file() else None


def _reference_errors(rows: list[dict], requirement_ids: set[str], location: str) -> list[str]:
    errors = []
    for index, row in enumerate(rows):
        for requirement_id in row.get("requirement_ids", []):
            if requirement_id not in requirement_ids:
                errors.append(f"{location}[{index}]: unknown requirement {requirement_id}")
    return errors


def optional_model_errors(root: Path, project: dict, requirement_ids: set[str]) -> list[str]:
    """Validate optional delivery models and their real file side effects."""
    errors: list[str] = []
    project_id = project.get("project_id")
    current_version = project.get("current_version")
    current_baseline = project.get("current_baseline_id")

    technical = read_optional_json(root / "models" / "technical-design.json")
    if technical is not None and not isinstance(technical, dict):
        errors.extend(schema_errors(technical, "technical-design.schema.json", "technical_design"))
        technical = None
    if technical is not None:
        errors.extend(schema_errors(technical, "technical-design.schema.json", "technical_design"))
        if technical.get("project_id") != project_id:
            errors.append("technical_design: project_id mismatch")
        if technical.get("version") != current_version:
            errors.append("technical_design: version does not match project.current_version")
        if technical.get("status") == "approved" and not current_baseline:
            errors.append("technical_design: approved design requires a current baseline")
        errors.extend(_reference_errors(technical.get("decisions", []), requirement_ids, "technical_design.decisions"))
        errors.extend(_reference_errors(technical.get("diagrams", []), requirement_ids, "technical_design.diagrams"))
        for index, diagram in enumerate(technical.get("diagrams", [])):
            location = f"technical_design.diagrams[{index}]"
            for field in ("spec_path", "drawio_path", "png_path"):
                relative = diagram.get(field)
                if relative and not (root / relative).is_file():
                    errors.append(f"{location}: {field} does not exist: {relative}")
            if diagram.get("status") in {"generated", "verified"}:
                required_paths = ("spec_path", "drawio_path", "png_path") if diagram["status"] == "verified" else ("spec_path", "drawio_path")
                for field in required_paths:
                    if not diagram.get(field):
                        errors.append(f"{location}: {diagram['status']} diagram requires {field}")

    plan = read_optional_json(root / "models" / "delivery-plan.json")
    if plan is not None and not isinstance(plan, dict):
        errors.extend(schema_errors(plan, "delivery-plan.schema.json", "delivery_plan"))
        plan = None
    if plan is not None:
        errors.extend(schema_errors(plan, "delivery-plan.schema.json", "delivery_plan"))
        if plan.get("project_id") != project_id:
            errors.append("delivery_plan: project_id mismatch")
        if plan.get("version") != current_version:
            errors.append("delivery_plan: version does not match project.current_version")
        if plan.get("status") == "approved" and not current_baseline:
            errors.append("delivery_plan: approved plan requires a current baseline")
        items = plan.get("items", [])
        errors.extend(_reference_errors(items, requirement_ids, "delivery_plan.items"))
        work_ids = [item.get("work_id") for item in items]
        known_work_ids = set(work_ids)
        for index, item in enumerate(items):
            location = f"delivery_plan.items[{index}]"
            if work_ids.count(item.get("work_id")) > 1:
                errors.append(f"{location}: duplicate work_id {item.get('work_id')}")
            for dependency in item.get("dependencies", []):
                if dependency not in known_work_ids:
                    errors.append(f"{location}: unknown dependency {dependency}")
                if dependency == item.get("work_id"):
                    errors.append(f"{location}: work item cannot depend on itself")
            start_raw, end_raw = item.get("start_date"), item.get("end_date")
            if bool(start_raw) != bool(end_raw):
                errors.append(f"{location}: start_date and end_date must be provided together")
            start = end = None
            try:
                if start_raw:
                    start, end = date.fromisoformat(start_raw), date.fromisoformat(end_raw)
            except (TypeError, ValueError):
                errors.append(f"{location}: dates must use YYYY-MM-DD")
            if start and end and end < start:
                errors.append(f"{location}: end_date precedes start_date")
            if item.get("status") in {"confirmed", "in_progress", "completed", "blocked"}:
                if not item.get("owner"):
                    errors.append(f"{location}: {item['status']} item requires an owner")
                if not start_raw:
                    errors.append(f"{location}: {item['status']} item requires confirmed dates")

        # A Gantt dependency graph must be acyclic; use Kahn's algorithm so
        # long dependency chains do not depend on recursive graph walking.
        indegree = {work_id: 0 for work_id in known_work_ids}
        dependents = {work_id: [] for work_id in known_work_ids}
        for item in items:
            work_id = item.get("work_id")
            for dependency in item.get("dependencies", []):
                if dependency in known_work_ids and dependency != work_id:
                    indegree[work_id] += 1
                    dependents[dependency].append(work_id)
        ready = sorted(work_id for work_id, degree in indegree.items() if degree == 0)
        processed = 0
        while ready:
            work_id = ready.pop()
            processed += 1
            for dependent in dependents[work_id]:
                indegree[dependent] -= 1
                if indegree[dependent] == 0:
                    ready.append(dependent)
        if processed != len(items):
            errors.append("delivery_plan.items: dependency cycle detected")

    brief = read_optional_json(root / "models" / "deck-brief.json")
    if brief is not None and not isinstance(brief, dict):
        errors.extend(schema_errors(brief, "deck-brief.schema.json", "deck_brief"))
        brief = None
    if brief is not None:
        errors.extend(schema_errors(brief, "deck-brief.schema.json", "deck_brief"))
        if brief.get("project_id") != project_id:
            errors.append("deck_brief: project_id mismatch")
        if brief.get("version") != current_version:
            errors.append("deck_brief: version does not match project.current_version")
        if brief.get("review_status") == "approved" and not brief.get("baseline_id"):
            errors.append("deck_brief: approved brief requires a baseline")
        slides = brief.get("slides", [])
        errors.extend(_reference_errors(slides, requirement_ids, "deck_brief.slides"))
        slide_ids = [slide.get("slide_id") for slide in slides]
        if len(slide_ids) != len(set(slide_ids)):
            errors.append("deck_brief.slides: duplicate slide_id")
        output_paths = brief.get("output_paths", [])
        if brief.get("export_status") == "exported":
            if brief.get("review_status") != "approved" or not brief.get("baseline_id"):
                errors.append("deck_brief: exported deck requires an approved brief and baseline")
            if not output_paths:
                errors.append("deck_brief: exported deck requires output_paths")
            if not any(str(path).lower().endswith((".pptx", ".html")) for path in output_paths):
                errors.append("deck_brief: exported deck requires a PPTX or HTML output")
        elif output_paths:
            errors.append("deck_brief: output_paths are only valid after a real export")
        for relative in output_paths:
            output = root / relative
            if not output.is_file():
                errors.append(f"deck_brief: output does not exist: {relative}")
                continue
            if output.suffix.lower() == ".pptx":
                try:
                    with ZipFile(output) as package:
                        names = set(package.namelist())
                        missing = {"[Content_Types].xml", "ppt/presentation.xml"} - names
                        if missing:
                            errors.append(f"deck_brief: invalid PPTX package: {relative}")
                        if package.testzip() is not None:
                            errors.append(f"deck_brief: PPTX CRC validation failed: {relative}")
                except (BadZipFile, OSError):
                    errors.append(f"deck_brief: invalid PPTX package: {relative}")
            elif output.suffix.lower() == ".html":
                try:
                    content = output.read_text(encoding="utf-8")
                except (OSError, UnicodeError):
                    content = ""
                if "<html" not in content.lower():
                    errors.append(f"deck_brief: invalid HTML deck: {relative}")
            elif output.suffix.lower() == ".pdf":
                try:
                    with output.open("rb") as pdf:
                        if pdf.read(5) != b"%PDF-":
                            errors.append(f"deck_brief: invalid PDF deck: {relative}")
                except OSError:
                    errors.append(f"deck_brief: invalid PDF deck: {relative}")
    deck_directories = [root / "artifacts" / "deck", root / "artifacts" / "deck-handdrawn"]
    actual_decks = {
        path.relative_to(root).as_posix()
        for deck_dir in deck_directories if deck_dir.is_dir()
        for path in deck_dir.rglob("*")
        if path.is_file() and path.suffix.lower() in {".pptx", ".html", ".pdf"}
    }
    if actual_decks and brief is None:
        errors.append("deck_brief: actual deck files require a deck-brief model")
    elif actual_decks and brief.get("export_status") != "exported":
        errors.append("deck_brief: actual deck files cannot be registered before export is confirmed")
    elif actual_decks:
        for relative in sorted(actual_decks - set(output_paths)):
            errors.append(f"deck_brief: actual deck file is not registered: {relative}")
    return errors


def project_errors(project_dir: str | Path) -> list[str]:
    root = Path(project_dir)
    errors: list[str] = []
    required = [
        "project.json", "sources/sources.jsonl", "sources/transcript.jsonl",
        "evidence/evidence.jsonl", "requirements/requirements.json", "models/business-model.json",
    ]
    for relative in required:
        if not (root / relative).is_file():
            errors.append(f"missing {relative}")
    if errors:
        return errors
    try:
        project = read_json(root / "project.json")
        errors.extend(schema_errors(project, "project.schema.json", "project"))
        project_id = project.get("project_id")
        sources = read_jsonl(root / "sources" / "sources.jsonl")
        segments = read_jsonl(root / "sources" / "transcript.jsonl")
        evidence = read_jsonl(root / "evidence" / "evidence.jsonl")
        requirements = load_requirements(root)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        return [f"cannot load project data: {error}"]
    source_ids = set()
    for index, source in enumerate(sources):
        errors.extend(schema_errors(source, "source.schema.json", f"sources[{index}]"))
        if source.get("project_id") != project_id:
            errors.append(f"sources[{index}]: project_id mismatch")
        if source.get("source_id") in source_ids:
            errors.append(f"duplicate source_id {source.get('source_id')}")
        source_ids.add(source.get("source_id"))
    segment_ids = set()
    for index, segment in enumerate(segments):
        errors.extend(schema_errors(segment, "transcript_segment.schema.json", f"segments[{index}]"))
        if segment.get("source_id") not in source_ids:
            errors.append(f"segments[{index}]: unknown source_id")
        if segment.get("segment_id") in segment_ids:
            errors.append(f"duplicate segment_id {segment.get('segment_id')}")
        segment_ids.add(segment.get("segment_id"))
        start, end = segment.get("start_time"), segment.get("end_time")
        if start is not None and end is not None and end < start:
            errors.append(f"segments[{index}]: end_time precedes start_time")
    evidence_ids = {row.get("evidence_id") for row in evidence}
    requirement_ids = set()
    normalized_titles = {}
    for index, requirement in enumerate(requirements):
        location = f"requirements[{index}]"
        errors.extend(schema_errors(requirement, "requirement.schema.json", location))
        requirement_id = requirement.get("requirement_id")
        if requirement_id in requirement_ids:
            errors.append(f"{location}: duplicate requirement_id {requirement_id}")
        requirement_ids.add(requirement_id)
        if requirement.get("project_id") != project_id:
            errors.append(f"{location}: project_id mismatch")
        for evidence_id in requirement.get("evidence_ids", []):
            if evidence_id not in evidence_ids:
                errors.append(f"{location}: unknown evidence_id {evidence_id}")
        title_key = re.sub(r"\s+", "", requirement.get("title", "")).lower()
        if title_key in normalized_titles:
            errors.append(f"{location}: possible duplicate title with {normalized_titles[title_key]}")
        normalized_titles[title_key] = requirement_id
    errors.extend(evidence_errors(root))
    current_baseline = project.get("current_baseline_id")
    baseline_ids = set()
    baseline_dir = root / "baselines"
    for baseline_path in sorted(baseline_dir.glob("v*.json")):
        baseline = read_json(baseline_path)
        errors.extend(schema_errors(baseline, "baseline.schema.json", baseline_path.name))
        baseline_ids.add(baseline.get("baseline_id"))
        for requirement in baseline.get("confirmed_requirements", []):
            if requirement.get("requirement_id") not in requirement_ids:
                errors.append(f"{baseline_path.name}: unknown requirement {requirement.get('requirement_id')}")
    if current_baseline and current_baseline not in baseline_ids:
        errors.append("project.current_baseline_id does not exist")
    changeset_ids = set()
    for changeset_path in sorted((root / "changesets").glob("changeset-*.json")):
        changeset = read_json(changeset_path)
        errors.extend(schema_errors(changeset, "changeset.schema.json", changeset_path.name))
        changeset_id = changeset.get("changeset_id")
        if changeset_id in changeset_ids:
            errors.append(f"{changeset_path.name}: duplicate changeset_id {changeset_id}")
        changeset_ids.add(changeset_id)
    errors.extend(optional_model_errors(root, project, requirement_ids))
    return errors
