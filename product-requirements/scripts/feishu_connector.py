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
    def __init__(self, message, code=None):
        super().__init__(message)
        self.code = code


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


def call_cli(arguments, cwd=None):
    try:
        result = subprocess.run(['lark-cli', *arguments, '--as', 'user', '--format', 'json'], capture_output=True, text=True, timeout=600, cwd=cwd)
    except FileNotFoundError as error:
        raise ConnectorError('lark-cli is unavailable. Install it and authorize your Feishu user account.') from error
    raw = result.stdout if result.returncode == 0 else result.stderr or result.stdout
    payload = None
    # lark-cli may prepend download progress before its JSON envelope.
    decoder = json.JSONDecoder()
    for match in re.finditer(r'(?m)^\s*\{', raw):
        position = match.end() - 1
        try:
            value, end = decoder.raw_decode(raw[position:])
            if not raw[position + end:].strip():
                payload = value
                break
        except ValueError:
            continue
    if payload is None:
        raise ConnectorError('lark-cli returned an unreadable response.')
    if not isinstance(payload, dict):
        raise ConnectorError('lark-cli returned an unexpected response shape.')
    if result.returncode or payload.get('ok') is False:
        error = payload.get('error', {})
        scopes = error.get('missing_scopes', [])
        message = 'Feishu access failed'
        if 'blocked download URL' in error.get('message', ''):
            raise ConnectorError('Media download blocked by lark-cli URL safety checks for a local/internal host.')
        if scopes:
            message += '. Missing scopes: ' + ', '.join(scopes)
        else:
            message += '. Check resource access and whether the recording is ready.'
        raise ConnectorError(message, code=error.get('code'))
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
            payload = call_cli(['minutes', '+download', '--minute-tokens', token, '--output-dir', 'downloads'], cwd=root)
            records = payload.get('downloads', [payload])
            paths = [record.get('saved_path') for record in records if record.get('minute_token') == token and record.get('saved_path')]
        else:
            call_cli(['api', 'GET', '/open-apis/minutes/v1/minutes/' + token + '/transcript',
                      '--params', json.dumps({'file_format': 'srt', 'need_speaker': True, 'need_timestamp': True}),
                      '--output', 'transcript.srt'], cwd=root)
            paths = ['transcript.srt']
        if len(paths) != 1 or not paths[0]:
            raise ConnectorError('No requested artifact was returned. Check recording/transcript readiness and access.')
        file = Path(paths[0])
        file = (file if file.is_absolute() else root / file).resolve()
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
