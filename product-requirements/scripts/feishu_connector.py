#!/usr/bin/env python3
"""Feishu connector through lark-cli: self-check, Minutes import and prototype feedback import.

--check                 report whether lark-cli, login and Minutes scopes are ready
--minutes <url|token>   import a selected Minutes transcript (or --media recording)
--feedback-table <base_token>:<table_id>
                        import new comments left through the prototype's 提意见 form; imported record
                        IDs are remembered in <workspace>/prototype-feedback/imported.json
"""
import argparse
import json
import os
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


class BlockedDownload(ConnectorError):
    """lark-cli refused to fetch a download URL because its host name looks internal (e.g. internal-api-drive-stream.feishu.cn)."""


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


def lark_cli():
    """The lark-cli executable. On Windows npm installs it as lark-cli.cmd, which only PATH lookup with PATHEXT finds."""
    return shutil.which('lark-cli') or 'lark-cli'


def call_cli(arguments, cwd=None):
    try:
        result = subprocess.run([lark_cli(), *arguments, '--as', 'user', '--format', 'json'], capture_output=True, text=True, timeout=600, cwd=cwd)
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
            raise BlockedDownload('Media download blocked by lark-cli URL safety checks for a local/internal host.')
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
    result = subprocess.run([lark_cli(), *arguments, '--json'], capture_output=True, text=True, timeout=60)
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


MEDIA_HOSTS = ('.feishu.cn', '.larksuite.com', '.larkoffice.com', '.feishu.net')
MEDIA_LIMIT = 8 * 1024 ** 3  # refuse anything larger than 8 GB


def media_host_allowed(url):
    parsed = urlparse(url)
    host = (parsed.hostname or '').lower()
    return parsed.scheme == 'https' and any(host.endswith(suffix) for suffix in MEDIA_HOSTS)


def download_media(token, root):
    """Download a minute's recording from the signed link lark-cli returns, only from official Feishu/Lark HTTPS hosts."""
    from urllib.parse import unquote
    from urllib.request import Request, urlopen
    payload = call_cli(['minutes', '+download', '--minute-tokens', token, '--url-only'], cwd=root)
    links = []
    def walk(value):
        if isinstance(value, dict):
            for key, item in value.items():
                if key == 'download_url' and isinstance(item, str):
                    links.append(item)
                else:
                    walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)
    walk(payload)
    if len(links) != 1 or not media_host_allowed(links[0]):
        raise ConnectorError('Feishu did not return one official HTTPS download link for this recording.')
    target_dir = root / 'downloads'
    target_dir.mkdir(exist_ok=True)
    with urlopen(Request(links[0], headers={'User-Agent': 'product-requirements-skill'}), timeout=60) as response:
        if not media_host_allowed(response.geturl()):
            raise ConnectorError('The recording link redirected away from Feishu.')
        size = int(response.headers.get('Content-Length') or 0)
        if size > MEDIA_LIMIT:
            raise ConnectorError('The recording is larger than the 8 GB import limit.')
        match = re.search(r'filename="?([^";]+)"?', response.headers.get('Content-Disposition') or '')
        name = Path(unquote(match[1])).name if match else ''
        suffix = Path(name).suffix.lower()
        if not name or suffix not in {'.mp4', '.m4a', '.mp3', '.wav', '.mov', '.webm', '.aac', '.ogg', '.flac', '.mkv'}:
            name = token + ('.m4a' if 'audio' in (response.headers.get('Content-Type') or '') else '.mp4')
        target = target_dir / name
        written = 0
        with target.open('wb') as handle:
            while chunk := response.read(1024 * 1024):
                written += len(chunk)
                if written > MEDIA_LIMIT:
                    raise ConnectorError('The recording is larger than the 8 GB import limit.')
                handle.write(chunk)
    if size and written != size:
        raise ConnectorError('The recording download was incomplete; try again.')
    return str(target)


def import_minutes(value, workspace, project_id, media=False):
    token = minute_token(value)
    workspace = Path(workspace).resolve()
    workspace.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.feishu-', dir=workspace) as temporary:
        root = Path(temporary).resolve()
        if media:
            try:
                payload = call_cli(['minutes', '+download', '--minute-tokens', token, '--output-dir', 'downloads'], cwd=root)
                records = payload.get('downloads', [payload])
                paths = [record.get('saved_path') for record in records if record.get('minute_token') == token and record.get('saved_path')]
            except BlockedDownload:
                # lark-cli only refuses because Feishu's own stream host contains "internal"; fetch the signed link ourselves.
                paths = [download_media(token, root)]
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


# Prototype feedback: comments from the 提意见 Feishu Base form become one material per prototype version.
FIELDS = ('意见', '页面', '位置', '需求', '原型版本', '项目', '称呼')
TOKEN = re.compile(r'[A-Za-z0-9]{10,64}')
REQUIREMENT = re.compile(r'REQ-[A-Za-z0-9-]+')


def _text(value):
    if isinstance(value, list):
        return ' '.join(_text(item) for item in value).strip()
    if isinstance(value, dict):
        return str(value.get('text') or value.get('name') or '').strip()
    return '' if value is None else str(value).strip()


def fetch_feedback(base_token, table_id):
    rows, offset = [], 0
    while True:
        page = call_cli(['base', '+record-list', '--base-token', base_token, '--table-id', table_id,
                         '--limit', '200', '--offset', str(offset), *[arg for name in FIELDS for arg in ('--field-id', name)]])
        names = page.get('fields') or []
        for record_id, values in zip(page.get('record_id_list') or [], page.get('data') or []):
            rows.append({'record_id': record_id, **{name: _text(value) for name, value in zip(names, values)}})
        if not page.get('has_more'):
            return rows
        offset += len(page.get('data') or [])


def feedback_material(project_id, version, rows):
    lines = [f'客户原型反馈。项目：{project_id}。原型版本：{version}。来源：原型内“提意见”表单。']
    answers = []
    for row in rows:
        targets = REQUIREMENT.findall(row.get('需求', ''))
        place = row.get('位置') or row.get('页面') or '未注明'
        lines += ['', f'位置：{place}。需求：{" ".join(targets) or "未注明"}。', f'客户意见：{row["意见"]}']
        if row.get('称呼'):
            lines.append(f'客户称呼：{row["称呼"]}')
        for target in targets or [None]:
            answers.append({'target': target, 'prompt': f'原型「{place}」', 'answer': row['意见'],
                            'note': '', 'respondent': row.get('称呼', '')})
    return '\n'.join(lines) + '\n', {'respondent': '', 'answers': answers}


def import_feedback(base_token, table_id, workspace, project_id, rows=None):
    if not TOKEN.fullmatch(base_token) or not TOKEN.fullmatch(table_id):
        raise ConnectorError('Use the base token and table ID of the feedback form table.')
    workspace = Path(workspace).resolve()
    state_dir = workspace / 'prototype-feedback'
    state_dir.mkdir(parents=True, exist_ok=True)
    state_file = state_dir / 'imported.json'
    imported = set(json.loads(state_file.read_text(encoding='utf-8'))) if state_file.exists() else set()
    rows = fetch_feedback(base_token, table_id) if rows is None else rows
    fresh = [row for row in rows if row['record_id'] not in imported and row.get('项目') == project_id and row.get('意见')]
    jobs = []
    for version in sorted({row.get('原型版本') or 'unknown' for row in fresh}):
        group = [row for row in fresh if (row.get('原型版本') or 'unknown') == version]
        body, feedback = feedback_material(project_id, version, group)
        with tempfile.TemporaryDirectory(prefix='.feedback-', dir=state_dir) as temporary:
            file = Path(temporary) / f'prototype-feedback-{version}.txt'
            file.write_text(body, encoding='utf-8')
            job = ingest(file, workspace, project_id, {
                'provider': 'prototype_feedback', 'artifact_version': version,
                'record_ids': [row['record_id'] for row in group],
            }, metadata={'customer_feedback': feedback})
        if job['status'] == 'failed':
            raise ConnectorError(f'Feedback for {version} could not be preprocessed: {job.get("error", "unknown error")}')
        imported.update(row['record_id'] for row in group)
        jobs.append({'job_id': job['job_id'], 'artifact_version': version, 'comments': len(group)})
    temporary = state_file.with_suffix('.tmp')
    temporary.write_text(json.dumps(sorted(imported), ensure_ascii=False), encoding='utf-8')
    os.replace(temporary, state_file)
    return {'status': 'imported' if jobs else 'no_new_feedback', 'jobs': jobs,
            'skipped_other_projects': sum(1 for row in rows if row.get('项目') != project_id)}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--check', action='store_true', help='Only report whether lark-cli, login and Minutes scopes are ready.')
    parser.add_argument('--minutes')
    parser.add_argument('--feedback-table', help='<base_token>:<table_id> of the prototype feedback form table')
    parser.add_argument('--workspace', type=Path)
    parser.add_argument('--project-id')
    parser.add_argument('--media', action='store_true', help='Import the original recording instead of the transcript.')
    args = parser.parse_args()
    if args.check:
        result = check()
        print(json.dumps(result, ensure_ascii=False, indent=2))
        raise SystemExit(0 if result['status'] == 'ready' else 1)
    if not ((args.minutes or args.feedback_table) and args.workspace and args.project_id):
        parser.error('use --minutes or --feedback-table with --workspace and --project-id, or --check')
    try:
        if args.feedback_table:
            base_token, _, table_id = args.feedback_table.partition(':')
            print(json.dumps(import_feedback(base_token, table_id, args.workspace, args.project_id), ensure_ascii=False, indent=2))
            return
        job = import_minutes(args.minutes, args.workspace, args.project_id, args.media)
        print(json.dumps(job, ensure_ascii=False))
        if job['status'] == 'failed':
            raise SystemExit(1)
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        parser.exit(1, f'Feishu import failed: {error}\n')


if __name__ == '__main__':
    main()
