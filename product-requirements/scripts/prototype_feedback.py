#!/usr/bin/env python3
"""Import customer comments left through the prototype's 提意见 form (a Feishu Base form).

Each new comment becomes part of a text material per prototype version, ingested like any meeting
transcript, so the next analysis uses it as a source. Already imported record IDs are remembered in
<workspace>/prototype-feedback/imported.json; re-running only adds new comments.
"""
import argparse
import json
import os
from pathlib import Path
import re
import tempfile

from feishu_connector import ConnectorError, call_cli
from ingest_material import ingest

FIELDS = ('意见', '页面', '需求', '原型版本', '项目', '称呼')
TOKEN = re.compile(r'[A-Za-z0-9]{10,64}')
REQUIREMENT = re.compile(r'REQ-[A-Za-z0-9-]+')


def text(value):
    if isinstance(value, list):
        return ' '.join(text(item) for item in value).strip()
    if isinstance(value, dict):
        return str(value.get('text') or value.get('name') or '').strip()
    return '' if value is None else str(value).strip()


def fetch(base_token, table_id):
    rows, offset = [], 0
    while True:
        page = call_cli(['base', '+record-list', '--base-token', base_token, '--table-id', table_id,
                         '--limit', '200', '--offset', str(offset), *[arg for name in FIELDS for arg in ('--field-id', name)]])
        names = page.get('fields') or []
        for record_id, values in zip(page.get('record_id_list') or [], page.get('data') or []):
            rows.append({'record_id': record_id, **{name: text(value) for name, value in zip(names, values)}})
        if not page.get('has_more'):
            return rows
        offset += len(page.get('data') or [])


def material(project_id, version, rows):
    lines = [f'客户原型反馈。项目：{project_id}。原型版本：{version}。来源：原型内“提意见”表单。']
    answers = []
    for row in rows:
        targets = REQUIREMENT.findall(row.get('需求', ''))
        lines += ['', f'页面：{row.get("页面") or "未注明"}。需求：{" ".join(targets) or "未注明"}。', f'客户意见：{row["意见"]}']
        if row.get('称呼'):
            lines.append(f'客户称呼：{row["称呼"]}')
        for target in targets or [None]:
            answers.append({'target': target, 'prompt': f'原型页面「{row.get("页面") or "未注明"}」', 'answer': row['意见'],
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
    rows = fetch(base_token, table_id) if rows is None else rows
    fresh = [row for row in rows if row['record_id'] not in imported and row.get('项目') == project_id and row.get('意见')]
    jobs = []
    for version in sorted({row.get('原型版本') or 'unknown' for row in fresh}):
        group = [row for row in fresh if (row.get('原型版本') or 'unknown') == version]
        body, feedback = material(project_id, version, group)
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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-token', required=True)
    parser.add_argument('--table-id', required=True)
    parser.add_argument('--workspace', type=Path, required=True)
    parser.add_argument('--project-id', required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(import_feedback(args.base_token, args.table_id, args.workspace, args.project_id), ensure_ascii=False, indent=2))
    except (OSError, ValueError) as error:
        parser.exit(1, f'Feedback import failed: {error}\n')


if __name__ == '__main__':
    main()
