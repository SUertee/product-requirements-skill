#!/usr/bin/env python3
"""Import an explicitly selected Feishu Minutes transcript or recording via lark-cli."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import urlparse

from ingest_material import ingest


class ConnectorError(ValueError):
    pass


def minute_token(value):
    if '://' in value:
        url = urlparse(value)
        host = url.hostname or ''
        if url.scheme != 'https' or not any(host == domain or host.endswith('.' + domain) for domain in ['feishu.cn', 'larksuite.com']):
            raise ConnectorError('Use an HTTPS Feishu/Lark Minutes URL.')
        match = re.fullmatch(r'/minutes/([a-zA-Z0-9]{10,64})/?', url.path)
        if not match:
            raise ConnectorError('Use a Minutes URL containing /minutes/<token>.')
        return match[1]
    if not re.fullmatch(r'[a-zA-Z0-9]{10,64}', value):
        raise ConnectorError('Invalid minute token.')
    return value


def call_cli(arguments):
    try:
        result = subprocess.run(['lark-cli', *arguments, '--as', 'user', '--format', 'json'], capture_output=True, text=True, timeout=600)
    except FileNotFoundError as error:
        raise ConnectorError('lark-cli is unavailable. Install it and authorize your Feishu user account.') from error
    try:
        payload = json.loads(result.stdout)
    except ValueError as error:
        raise ConnectorError('lark-cli returned an unreadable response.') from error
    if not isinstance(payload, dict):
        raise ConnectorError('lark-cli returned an unexpected response shape.')
    if result.returncode or payload.get('ok') is False:
        error = payload.get('error', {})
        scopes = error.get('missing_scopes', [])
        message = 'Feishu access failed'
        if scopes:
            message += '. Missing scopes: ' + ', '.join(scopes)
        else:
            message += '. Check resource access and whether the recording is ready.'
        raise ConnectorError(message)
    data = payload.get('data', payload)
    if not isinstance(data, dict):
        raise ConnectorError('lark-cli returned unexpected artifact data.')
    return data


def import_minutes(value, workspace, project_id, media=False):
    token = minute_token(value)
    workspace = Path(workspace).resolve()
    workspace.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.feishu-', dir=workspace) as temporary:
        root = Path(temporary).resolve()
        if media:
            payload = call_cli(['minutes', '+download', '--minute-tokens', token, '--output-dir', str(root)])
            records = payload.get('downloads', [payload])
            paths = [record.get('saved_path') for record in records if record.get('minute_token') == token and record.get('saved_path')]
        else:
            payload = call_cli(['minutes', '+detail', '--minute-tokens', token, '--transcript', '--output-dir', str(root)])
            paths = [item.get('artifacts', {}).get('transcript_file') for item in payload.get('minutes', []) if item.get('minute_token') == token]
        if len(paths) != 1 or not paths[0]:
            raise ConnectorError('No requested artifact was returned. Check recording/transcript readiness and access.')
        file = Path(paths[0]).resolve()
        if not file.is_relative_to(root) or not file.is_file():
            raise ConnectorError('The downloaded artifact is outside the import directory or is missing.')
        return ingest(file, workspace, project_id, {'provider': 'feishu', 'minute_token': token, 'identity': 'user', 'artifact': 'media' if media else 'transcript'})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--minutes', required=True)
    parser.add_argument('--workspace', type=Path, required=True)
    parser.add_argument('--project-id', required=True)
    parser.add_argument('--media', action='store_true', help='Import the original recording instead of the transcript.')
    args = parser.parse_args()
    try:
        job = import_minutes(args.minutes, args.workspace, args.project_id, args.media)
        print(json.dumps(job, ensure_ascii=False))
        if job['status'] == 'failed':
            raise SystemExit(1)
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        parser.exit(1, f'Feishu import failed: {error}\n')


if __name__ == '__main__':
    main()
