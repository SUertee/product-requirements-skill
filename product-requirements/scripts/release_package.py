#!/usr/bin/env python3
"""Build a customer-only prototype package from explicit version-bound release review."""
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import shutil
import tempfile
from urllib.parse import urlparse, unquote
import zipfile

from project_revision import digest


class ResourceLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        for key in ['src', 'href']:
            value = attributes.get(key)
            if value and not (tag == 'a' and urlparse(value).scheme in {'https', 'http', 'mailto'}):
                self.links.append(value)
        if attributes.get('srcset'):
            raise ValueError('Resolve srcset dependencies before packaging this prototype.')


def resources(file, relative):
    values = []
    if file.suffix == '.html':
        parser = ResourceLinks()
        parser.feed(file.read_text(encoding='utf-8'))
        values.extend(parser.links)
    if file.suffix in {'.html', '.css'}:
        values.extend(re.findall(r'url\(\s*[\'"]?([^\)\'"\s]+)', file.read_text(encoding='utf-8')))
    paths = []
    for value in values:
        parsed = urlparse(value)
        if value.startswith(('#', 'data:', 'blob:')):
            continue
        if parsed.scheme or parsed.netloc or parsed.path.startswith('/'):
            raise ValueError('Customer resources must be self-contained relative files.')
        path = posixpath.normpath(posixpath.join(posixpath.dirname(relative), unquote(parsed.path)))
        if path != 'prototype' and not path.startswith('prototype/'):
            raise ValueError('Prototype links to a file outside its customer scope.')
        paths.append(path)
    return paths


def build_release(run_dir, workspace, selected_files, review_notes):
    run = Path(run_dir).resolve(strict=True)
    project = json.loads((run / 'project.json').read_text())
    manifest = json.loads((run / 'manifest.json').read_text())
    if review_notes.get('project_id') != project['project_id'] or review_notes.get('artifact_version') != project['artifact_version']:
        raise ValueError('Release review must match this project and artifact version.')
    if not isinstance(selected_files, list) or not selected_files or not all(isinstance(path, str) for path in selected_files):
        raise ValueError('Choose the customer prototype files to package.')
    confirmed = {}
    for decision in review_notes.get('decisions', []):
        if decision.get('review_stage') != 'release' or decision.get('artifact_version') != project['artifact_version']:
            continue
        confirmed[decision.get('target')] = decision
    artifacts = {item['path']: item for item in manifest['artifacts']}
    pending = list(dict.fromkeys(selected_files))
    selected = set()
    for path in selected_files:
        if path not in confirmed or confirmed[path].get('outcome') != 'confirmed' or not confirmed[path].get('decision_id'):
            raise ValueError('Each selected entry file needs final release confirmation.')
    while pending:
        relative = pending.pop()
        if relative in selected:
            continue
        path = PurePosixPath(relative)
        if path.is_absolute() or '..' in path.parts or '\\' in relative or ':' in relative or not relative.startswith('prototype/'):
            raise ValueError('Only prototype files can enter the customer package.')
        record = artifacts.get(relative)
        source = (run / relative).resolve()
        if not record or not source.is_relative_to(run) or not source.is_file() or record.get('generation_status') != 'success':
            raise ValueError('Selected prototype file is unavailable in this version.')
        if hashlib.sha256(source.read_bytes()).hexdigest() != record.get('sha256'):
            raise ValueError('Prototype changed after generation. Regenerate and review its version.')
        selected.add(relative)
        pending.extend(resources(source, relative))
        pending.extend(record.get('runtime_dependencies', []))
    if not any(path.endswith('.html') for path in selected_files):
        raise ValueError('Choose at least one HTML prototype entry.')
    identity = digest({'project': digest(project), 'selected': sorted(selected), 'hashes': {path: artifacts[path]['sha256'] for path in selected}, 'review': review_notes})
    release_id = 'REL-' + identity[:24]
    root = Path(workspace).resolve() / 'releases'
    root.mkdir(parents=True, exist_ok=True)
    destination = root / release_id
    if destination.exists():
        return json.loads((destination / 'release.json').read_text())
    stage = Path(tempfile.mkdtemp(prefix='.release-', dir=root))
    try:
        package = stage / 'package'
        package.mkdir()
        public_artifacts = []
        for relative in sorted(selected):
            output = package / relative
            output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(run / relative, output)
            public_artifacts.append({'path': relative, 'sha256': artifacts[relative]['sha256'], 'audience': 'customer', 'artifact_version': project['artifact_version']})
        entries = [path for path in selected_files if path.endswith('.html')]
        # The fixed destination is relative and has passed the prototype-only path checks.
        import html
        from urllib.parse import quote
        index = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>客户原型</title><body><a href="' + html.escape(quote(entries[0], safe='/'), quote=True) + '">打开原型</a></body></html>'
        (package / 'index.html').write_text(index, encoding='utf-8')
        metadata = {'release_id': release_id, 'project_id': project['project_id'], 'artifact_version': project['artifact_version'],
                    'created_at': datetime.now(timezone.utc).isoformat(), 'entries': entries, 'files': sorted(selected),
                    'review_stage': 'release', 'decision_ids': [confirmed[path]['decision_id'] for path in selected_files], 'review_sha256': digest(review_notes),
                    'deployment_status': 'package_ready', 'deployment_url': None}
        (package / 'manifest.json').write_text(json.dumps({'project_id': project['project_id'], 'artifact_version': project['artifact_version'], 'artifacts': public_artifacts}, ensure_ascii=False, indent=2), encoding='utf-8')
        (package / 'release.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
        with zipfile.ZipFile(stage / 'package.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
            for file in sorted(package.rglob('*')):
                if file.is_file():
                    archive.write(file, file.relative_to(package).as_posix())
        (stage / 'release.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
        (stage / 'review-notes.json').write_text(json.dumps(review_notes, ensure_ascii=False, indent=2), encoding='utf-8')
        try:
            os.rename(stage, destination)
        except OSError:
            if (destination / 'release.json').is_file():
                return json.loads((destination / 'release.json').read_text())
            raise
        return metadata
    finally:
        if stage.exists():
            shutil.rmtree(stage)
