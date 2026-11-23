#!/usr/bin/env python3
"""Build a byte-reproducible Skill zip with a per-file SHA-256 manifest.

The archive has a single root directory named after the Skill, so it can be extracted straight into a
host skills directory such as .codeartsdoer/skills. Caches, dotfiles and editor leftovers are excluded.
Adapted from the fix/incremental-safety-and-package branch (HankGrimm) for this package layout.
"""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

PACKAGE = Path(__file__).resolve().parent.parent
NAME = PACKAGE.name
FIXED_TIMESTAMP = (1980, 1, 1, 0, 0, 0)
EXCLUDED_PARTS = {'__pycache__', 'node_modules', '.git', 'runs', 'dist', 'recordings', '.pytest_cache'}
EXCLUDED_SUFFIXES = {'.pyc', '.pyo', '.tmp', '.log'}
REQUIRED = (
    'SKILL.md', 'integrations.json',
    'assets/workbench-template.html', 'assets/workbench.css', 'assets/workbench.js',
    'assets/prototype-template.html', 'assets/prototype-shell.html', 'assets/ui.css',
    'references/execution.md', 'references/prototype.md',
    'scripts/workflow.py', 'scripts/build_documents.py', 'scripts/prototype_design.py', 'scripts/serve_workbench.py',
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
    entries = [(key, path.read_bytes()) for key, path in files.items()]
    entries.append(('PACKAGE_MANIFEST.json', (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8')))
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for key, content in entries:
            info = zipfile.ZipInfo(f'{NAME}/{key}', date_time=FIXED_TIMESTAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, content)
    return {'status': 'packaged', 'output': str(output), 'package': NAME, 'files': len(entries), 'bytes': output.stat().st_size,
            'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}


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
