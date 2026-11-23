#!/usr/bin/env python3
"""Build a byte-reproducible Skill zip with a per-file SHA-256 manifest.

The archive has a single root directory named after the Skill, so it can be extracted straight into a
host skills directory such as .codeartsdoer/skills. Caches, dotfiles and editor leftovers are excluded.
The competition allows at most 30 files per Skill, so the SHA-256 manifest is written beside the zip
(<name>.manifest.json) instead of inside it, and packaging fails when the limit is exceeded.
Development tool: lives outside the Skill package. Adapted from the fix/incremental-safety-and-package
branch (HankGrimm).
"""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

PACKAGE = Path(__file__).resolve().parent.parent / 'product-requirements'
MAX_FILES = 30
NAME = PACKAGE.name
FIXED_TIMESTAMP = (1980, 1, 1, 0, 0, 0)
EXCLUDED_PARTS = {'__pycache__', 'node_modules', '.git', 'runs', 'dist', 'recordings', '.pytest_cache'}
EXCLUDED_SUFFIXES = {'.pyc', '.pyo', '.tmp', '.log'}
REQUIRED = (
    'SKILL.md', 'integrations.json',
    'assets/workbench-template.html', 'assets/workbench.css', 'assets/workbench.js', 'assets/document-templates.md',
    'assets/prototype-template.html', 'assets/prototype-shell.html', 'assets/ui.css',
    'references/execution.md', 'references/prototype.md', 'references/ui-design.md',
    'scripts/workflow.py', 'scripts/build_documents.py', 'scripts/prototype_design.py', 'scripts/serve_workbench.py',
    'scripts/feishu_connector.py', 'scripts/generate_artifacts.py',
)


def collect():
    files = {}
    for path in PACKAGE.rglob('*'):
        if not path.is_file():
            continue
        relative = path.relative_to(PACKAGE)
        if any(part in EXCLUDED_PARTS or part.startswith('.') for part in relative.parts) or path.suffix in EXCLUDED_SUFFIXES:
            continue
        files[relative.as_posix()] = path
    missing = [name for name in REQUIRED if name not in files]
    if missing:
        raise ValueError('Package is missing required files: ' + ', '.join(missing))
    if len(files) > MAX_FILES:
        raise ValueError(f'Package has {len(files)} files; the limit is {MAX_FILES}')
    skill = files['SKILL.md'].read_text(encoding='utf-8')
    if f'name: {NAME}\n' not in skill:
        raise ValueError(f'SKILL.md name must match the package directory {NAME}')
    return dict(sorted(files.items()))


def build(output):
    files = collect()
    manifest = {'schema_version': '1.0', 'name': NAME, 'root_directory': NAME, 'entrypoint': 'SKILL.md', 'file_count': len(files),
                'files': [{'path': key, 'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()} for key, path in files.items()]}
    output = Path(output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for key, path in files.items():
            info = zipfile.ZipInfo(f'{NAME}/{key}', date_time=FIXED_TIMESTAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, path.read_bytes())
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    manifest['package_sha256'] = digest
    sidecar = output.with_name(output.stem + '.manifest.json')
    sidecar.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return {'status': 'packaged', 'output': str(output), 'manifest': str(sidecar), 'package': NAME, 'files': len(files),
            'limit': MAX_FILES, 'bytes': output.stat().st_size, 'sha256': digest}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=PACKAGE.parent / 'dist' / f'{NAME}.zip')
    args = parser.parse_args()
    try:
        result = build(args.output)
    except (OSError, ValueError) as error:
        parser.exit(1, f'Packaging failed: {error}\n')
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
