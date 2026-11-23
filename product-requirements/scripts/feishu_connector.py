#!/usr/bin/env python3
"""Import an explicitly selected Feishu Minutes transcript or recording via lark-cli."""
import argparse
import json
from pathlib import Path
import re
import shutil
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


TRANSCRIPT_SCOPES = ['minutes:minutes.basic:read', 'minutes:minutes.transcript:export']
OPTIONAL_SCOPES = ['minutes:minutes.search:read', 'minutes:minutes.media:export']


def _json_command(arguments):
    result = subprocess.run(['lark-cli', *arguments, '--json'], capture_output=True, text=True, timeout=60)
    try:
        return json.loads(result.stdout or result.stderr)
    except ValueError:
        return {}


def check():
    """Report whether Minutes import can run here, with the fix for each failed item."""
    items = []
    def add(name, ok, detail, fix=None, required=True):
        items.append({'name': name, 'ok': ok, 'required': required, 'detail': detail, **({'fix': fix} if fix and not ok else {})})
    if not shutil.which('lark-cli'):
        add('lark-cli', False, 'lark-cli is not on PATH.', 'npm install -g @larksuite/cli, then lark-cli config init')
    else:
        add('lark-cli', True, 'lark-cli is installed.')
        try:
            status = _json_command(['auth', 'status'])
            user = (status.get('identities') or {}).get('user') or {}
            add('user identity', bool(user.get('available')), user.get('message') or user.get('status') or 'no user login',
                'lark-cli auth login --scope "' + ' '.join(TRANSCRIPT_SCOPES + OPTIONAL_SCOPES) + '"')
            if user.get('available'):
                scopes = _json_command(['auth', 'check', '--scope', ' '.join(TRANSCRIPT_SCOPES + OPTIONAL_SCOPES)])
                granted = set(scopes.get('granted') or [])
                for scope in TRANSCRIPT_SCOPES + OPTIONAL_SCOPES:
                    add(scope, scope in granted, 'granted' if scope in granted else 'missing',
                        'lark-cli auth login --scope "' + scope + '"', required=scope in TRANSCRIPT_SCOPES)
        except (OSError, subprocess.TimeoutExpired) as error:
            add('user identity', False, f'lark-cli did not answer: {error}', 'Run lark-cli auth status to see the problem.')
    ready = all(item['ok'] for item in items if item['required'])
    return {'status': 'ready' if ready else 'not_ready', 'connector': 'feishu-minutes', 'checks': items,
            'fallback': None if ready else 'Import a TXT, SRT or VTT transcript exported from the meeting tool instead.'}


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
    parser.add_argument('--check', action='store_true', help='Only report whether lark-cli, login and Minutes scopes are ready.')
    parser.add_argument('--minutes')
    parser.add_argument('--workspace', type=Path)
    parser.add_argument('--project-id')
    parser.add_argument('--media', action='store_true', help='Import the original recording instead of the transcript.')
    args = parser.parse_args()
    if args.check:
        result = check()
        print(json.dumps(result, ensure_ascii=False, indent=2))
        raise SystemExit(0 if result['status'] == 'ready' else 1)
    if not (args.minutes and args.workspace and args.project_id):
        parser.error('--minutes, --workspace and --project-id are required unless --check is used')
    try:
        job = import_minutes(args.minutes, args.workspace, args.project_id, args.media)
        print(json.dumps(job, ensure_ascii=False))
        if job['status'] == 'failed':
            raise SystemExit(1)
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        parser.exit(1, f'Feishu import failed: {error}\n')


if __name__ == '__main__':
    main()
