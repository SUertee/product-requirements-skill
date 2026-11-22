#!/usr/bin/env python3
"""Build a clean, deterministic distributable Skill zip from this source tree.

The archive has a single root directory named after the Skill, so it can be
extracted straight into a host's skills directory. Development-only data
(``runs/``, ``examples/output/``, caches, tests, node_modules, .git) is excluded;
small fixtures needed by ``run_demo.py`` / ``run_evals.py`` are included so the
extracted package can actually run its own documented commands.
"""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

from project_lib import SKILL_ROOT

PACKAGE_NAME = "product-requirements-skill"
FIXED_TIMESTAMP = (1980, 1, 1, 0, 0, 0)

CORE_FILES = (
    "SKILL.md",
    "README.md",
    "integrations.json",
    "package.json",
    "docs/OPEN_SOURCE_ATTRIBUTION.md",
    "docs/OPEN_SOURCE_AUDIT.md",
)
CORE_DIRS = (
    "assets",
    "references",
    "schemas",
    "scripts",
    "tests/fixtures",
    "examples/input",
    "examples/expected-output",
    "evals",
)
EXCLUDED_DIR_NAMES = {
    "__pycache__", "node_modules", ".git", "runs", "dist",
    "recordings", ".review", ".opencode", ".pytest_cache",
}
EXCLUDED_SUFFIXES = {".pyc", ".pyo", ".tmp", ".log"}
REQUIRED_FILES = (
    "SKILL.md",
    "integrations.json",
    "assets/workbench-template.html",
    "assets/workbench.css",
    "assets/workbench.js",
    "assets/prototype-template.html",
    "assets/ui.css",
    "assets/schedule-template.html",
    "references/execution.md",
    "schemas/project.schema.json",
    "scripts/render_artifacts.py",
    "scripts/artifact_state.py",
    "scripts/prototype.py",
    "scripts/package_skill.py",
)


def collect_files():
    """Return a sorted mapping of POSIX relative path -> absolute source path."""
    files = {}
    for relative in CORE_FILES:
        path = SKILL_ROOT / relative
        if not path.is_file():
            raise FileNotFoundError(f"Required package file is missing: {relative}")
        files[relative] = path
    for relative in CORE_DIRS:
        base = SKILL_ROOT / relative
        if not base.is_dir():
            raise FileNotFoundError(f"Required package directory is missing: {relative}")
        for path in base.rglob("*"):
            if not path.is_file():
                continue
            candidate = path.relative_to(SKILL_ROOT)
            if any(part in EXCLUDED_DIR_NAMES for part in candidate.parts):
                continue
            if path.suffix in EXCLUDED_SUFFIXES or path.name.startswith("."):
                continue
            files[candidate.as_posix()] = path
    missing = [name for name in REQUIRED_FILES if name not in files]
    if missing:
        raise ValueError("Package is missing required files: " + ", ".join(missing))
    return dict(sorted(files.items()))


def build(output):
    """Write the zip and return a JSON-serializable summary."""
    files = collect_files()
    manifest = {
        "schema_version": "1.0",
        "name": PACKAGE_NAME,
        "root_directory": PACKAGE_NAME,
        "entrypoint": "SKILL.md",
        "source_file_count": len(files),
        "archive_entries": len(files) + 1,
        "files": [
            {
                "path": relative,
                "bytes": path.stat().st_size,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            }
            for relative, path in files.items()
        ],
    }
    output = Path(output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for relative, path in files.items():
            info = zipfile.ZipInfo(f"{PACKAGE_NAME}/{relative}", date_time=FIXED_TIMESTAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, path.read_bytes())
        info = zipfile.ZipInfo(f"{PACKAGE_NAME}/PACKAGE_MANIFEST.json", date_time=FIXED_TIMESTAMP)
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    return {
        "status": "packaged",
        "output": str(output),
        "package": PACKAGE_NAME,
        "files": len(files) + 1,
        "bytes": output.stat().st_size,
        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=SKILL_ROOT / "dist" / "product-requirements-skill.zip")
    args = parser.parse_args()
    try:
        result = build(args.output)
    except (OSError, ValueError) as error:
        parser.exit(1, f"Packaging failed: {error}\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
