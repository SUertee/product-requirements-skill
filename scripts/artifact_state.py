#!/usr/bin/env python3
"""Protect human artifact edits and skip byte-identical renderer writes."""
import hashlib
import json
from pathlib import Path

from project_lib import atomic_write_text, read_json, utc_now, write_json

STATE_RELATIVE = "reviews/render-state.json"


class ManualArtifactConflict(ValueError):
    """Raised before any managed artifact is written."""

    def __init__(self, paths):
        self.paths = sorted(paths)
        instructions = " ".join(f"--approve-artifact {path}" for path in self.paths)
        super().__init__(
            "Manual artifact edits detected; no files were written. Review and explicitly approve each overwrite: "
            + ", ".join(self.paths)
            + (". Example: " + instructions if instructions else "")
        )


def file_hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def content_hash(content):
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def load_state(root):
    path = Path(root) / STATE_RELATIVE
    if path.is_file():
        return read_json(path)
    return {"schema_version": "1.0", "files": {}}


def _manifest_hashes(root):
    path = Path(root) / "manifest.json"
    if not path.is_file():
        return {}
    try:
        manifest = read_json(path)
    except (OSError, ValueError, json.JSONDecodeError):
        return {}
    return {
        item["path"]: item["sha256"]
        for item in manifest.get("files", [])
        if isinstance(item, dict) and item.get("path") and item.get("sha256")
    }


def _legacy_snapshot_hash(root, relative):
    root = Path(root)
    project_path = root / "project.json"
    if not project_path.is_file() or not relative.startswith("artifacts/"):
        return None
    project = read_json(project_path)
    snapshot = root / "artifacts" / "versions" / project["current_version"] / relative.removeprefix("artifacts/")
    return file_hash(snapshot) if snapshot.is_file() else None


def preflight(root, relatives, approved_overwrites=None):
    """Reject unapproved edits before rendering, including first-run legacy files."""
    root = Path(root)
    approved = set(approved_overwrites or [])
    state_hashes = {path: item.get("sha256") if isinstance(item, dict) else item for path, item in load_state(root).get("files", {}).items()}
    manifest_hashes = _manifest_hashes(root)
    conflicts = []
    approved_conflicts = []
    for relative in sorted(set(relatives)):
        destination = root / relative
        if not destination.is_file():
            continue
        current = file_hash(destination)
        expected = state_hashes.get(relative) or manifest_hashes.get(relative) or _legacy_snapshot_hash(root, relative)
        if expected != current:
            if relative in approved:
                approved_conflicts.append(relative)
            else:
                conflicts.append(relative)
    if conflicts:
        raise ManualArtifactConflict(conflicts)
    return approved_conflicts


def write_if_changed(path, content):
    """Write only when UTF-8 content differs; return (changed, sha256)."""
    path = Path(path)
    digest = content_hash(content)
    if path.is_file() and file_hash(path) == digest:
        return False, digest
    atomic_write_text(path, content)
    return True, digest


def snapshot_without_overwrite(path, content):
    """Create a historical snapshot once; never mutate an existing version."""
    path = Path(path)
    if path.is_file():
        return False
    atomic_write_text(path, content)
    return True


def record_approved_overwrites(root, approved_overwrites):
    """Append explicit overwrite decisions to the review trail."""
    approved = sorted(set(approved_overwrites or []))
    if not approved:
        return
    root = Path(root)
    path = root / "reviews" / "review.json"
    reviews = read_json(path) if path.is_file() else {"schema_version": "1.0", "records": []}
    reviews.setdefault("records", []).extend([
        {
            "action": "artifact_overwrite_approved",
            "actor": "explicit-render-approval",
            "path": relative,
            "at": utc_now(),
            "reason": "User explicitly approved replacing the manually edited generated artifact",
        }
        for relative in approved
    ])
    write_json(path, reviews)


def update_state(root, project, generated_hashes):
    """Persist generated hashes without changing state on a no-op render."""
    root = Path(root)
    state = load_state(root)
    state.update({
        "schema_version": "1.0",
        "project_id": project["project_id"],
        "artifact_version": project["current_version"],
        "generator": "render_artifacts.py",
    })
    state.setdefault("files", {}).update(generated_hashes)
    content = json.dumps(state, ensure_ascii=False, indent=2) + "\n"
    return write_if_changed(root / STATE_RELATIVE, content)[0]
