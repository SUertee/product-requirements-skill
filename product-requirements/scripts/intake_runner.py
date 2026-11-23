#!/usr/bin/env python3
"""Watch an explicitly selected input folder and run configured ASR/analysis adapters."""
import argparse
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import json
import os
import re
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import time

from ingest_material import ingest, read_job, TEXT, MEDIA
from feishu_connector import call_cli, import_minutes, ConnectorError
from project_revision import digest
from workflow import Workflow, WorkflowConflict, read_json, now, process_alive


def transcribe(workspace, job_id, configuration):
    workflow = Workflow(workspace)
    if not isinstance(job_id, str) or not re.fullmatch(r'JOB-[a-f0-9]{24}', job_id):
        raise ValueError('Invalid recording job identifier.')
    directory = workflow.workspace / 'jobs' / job_id
    job = read_job(directory)
    if job['kind'] != 'recording' or job['status'] == 'failed':
        raise ValueError('Choose a usable recording job.')
    argv = configuration.get('argv')
    if not isinstance(argv, list) or not argv or not all(isinstance(value, str) and value for value in argv):
        raise ValueError('Configure the ASR command as an argv array.')
    input_file = directory / job['files'].get('audio', job['files']['original'])
    if not any('{output}' in value for value in argv) or not any('{input}' in value for value in argv):
        raise ValueError('ASR argv must specify {input} and {output} file placeholders.')
    identity = 'ASR-' + digest([job_id, configuration])[:24]
    with sqlite3.connect(workflow.database) as db:
        db.execute('CREATE TABLE IF NOT EXISTS asr_runs (id TEXT PRIMARY KEY, project TEXT, job TEXT, status TEXT, pid INTEGER, attempt INTEGER, transcript TEXT, error TEXT, updated TEXT)')
        db.execute('BEGIN IMMEDIATE')
        row = db.execute('SELECT status,pid,transcript FROM asr_runs WHERE id=?', (identity,)).fetchone()
        if row and row[0] == 'completed' and (workflow.workspace / 'jobs' / row[2] / 'job.json').is_file():
            return read_job(workflow.workspace / 'jobs' / row[2])
        if row and row[0] == 'running':
            if process_alive(row[1]):
                raise WorkflowConflict('This recording already has an active ASR attempt.')
        if row:
            db.execute('UPDATE asr_runs SET status=?,pid=?,attempt=attempt+1,error=NULL,updated=? WHERE id=?', ('running', os.getpid(), now(), identity))
        else:
            db.execute('INSERT INTO asr_runs VALUES (?,?,?,?,?,?,?,?,?)', (identity, job['project_id'], job_id, 'running', os.getpid(), 1, None, None, now()))
    try:
        with tempfile.TemporaryDirectory(prefix='.asr-', dir=workflow.workspace) as temporary:
            output = Path(temporary) / 'transcript.srt'
            arguments = [value.replace('{input}', str(input_file)).replace('{output}', str(output)) for value in argv]
            result = subprocess.run(arguments, capture_output=True, text=True, cwd=temporary, timeout=configuration.get('timeout_seconds', 1200))
            if result.returncode or not output.is_file() or not output.stat().st_size:
                raise ValueError('ASR adapter did not produce a usable SRT transcript.')
            provenance = {'provider': configuration.get('provider', 'configured_asr'), 'model': configuration.get('model', 'unknown'),
                          'command_sha256': digest(argv), 'recording_job_id': job_id}
            transcript = ingest(output, workflow.workspace, job['project_id'], provenance=provenance, related_job_id=job_id)
            if transcript['status'] != 'ready_for_analysis':
                raise ValueError('ASR transcript normalization failed. Preserved job: ' + transcript['job_id'])
        with sqlite3.connect(workflow.database) as db:
            db.execute('UPDATE asr_runs SET status=?,pid=NULL,transcript=?,error=NULL,updated=? WHERE id=?', ('completed', transcript['job_id'], now(), identity))
        return transcript
    except Exception as error:
        message = 'ASR adapter timed out.' if isinstance(error, subprocess.TimeoutExpired) else str(error)
        with sqlite3.connect(workflow.database) as db:
            db.execute('UPDATE asr_runs SET status=?,pid=NULL,error=?,updated=? WHERE id=?', ('failed', message, now(), identity))
        if isinstance(error, subprocess.TimeoutExpired):
            raise ValueError(message) from None
        raise



class IntakeRunner:
    def __init__(self, workspace, run_dir, input_dir, stable_seconds=2, asr_config=None, analysis_config=None, minutes_query=None, minutes_interval=60):
        self.workflow = Workflow(workspace)
        self.run_dir = Path(run_dir).resolve(strict=True)
        self.input_dir = Path(input_dir).resolve(strict=True)
        self.project = read_json(self.run_dir / 'project.json')
        if not self.input_dir.is_dir() or stable_seconds < 0 or minutes_interval < 1:
            raise ValueError('Choose an input directory and nonnegative stability interval.')
        self.stable_seconds = stable_seconds
        self.asr_config = asr_config
        self.analysis_config = analysis_config
        self.minutes_query = minutes_query
        self.minutes_interval = minutes_interval
        self.last_minutes_poll = None
        with sqlite3.connect(self.workflow.database) as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('CREATE TABLE IF NOT EXISTS observed_files (project TEXT, path TEXT, fingerprint TEXT, first_seen REAL, job TEXT, error TEXT, PRIMARY KEY(project,path))')
            db.execute('CREATE TABLE IF NOT EXISTS observed_minutes (project TEXT, token TEXT, status TEXT, attempt INTEGER, job TEXT, error TEXT, pid INTEGER, PRIMARY KEY(project,token))')
            if 'pid' not in {row[1] for row in db.execute('PRAGMA table_info(observed_minutes)')}:
                db.execute('ALTER TABLE observed_minutes ADD COLUMN pid INTEGER')
            if 'error' not in {row[1] for row in db.execute('PRAGMA table_info(observed_files)')}:
                db.execute('ALTER TABLE observed_files ADD COLUMN error TEXT')

    def once(self):
        results = []
        for file in sorted(self.input_dir.rglob('*')):
            resolved = file.resolve()
            if not file.is_file() or file.name.startswith('.') or file.suffix.lower() not in TEXT | MEDIA or not resolved.is_relative_to(self.input_dir) or resolved.is_relative_to(self.workflow.workspace):
                continue
            stat = file.stat()
            fingerprint = str(stat.st_size) + ':' + str(stat.st_mtime_ns)
            with sqlite3.connect(self.workflow.database) as db:
                db.execute('BEGIN IMMEDIATE')
                row = db.execute('SELECT fingerprint,first_seen,job,error FROM observed_files WHERE project=? AND path=?', (self.project['project_id'], str(resolved))).fetchone()
                current = time.time()
                if row is None or row[0] != fingerprint:
                    db.execute('INSERT OR REPLACE INTO observed_files (project,path,fingerprint,first_seen,job,error) VALUES (?,?,?,?,?,NULL)', (self.project['project_id'], str(resolved), fingerprint, current, None))
                    first_seen, previous = current, None
                else:
                    first_seen, previous = row[1], row[2]
                    if row[3]:
                        continue
                if previous or current - first_seen < self.stable_seconds:
                    continue
            job = ingest(resolved, self.workflow.workspace, self.project['project_id'])
            result = {'path': str(resolved), 'job': job}
            try:
                if job['status'] == 'awaiting_transcript' and self.asr_config:
                    job = transcribe(self.workflow.workspace, job['job_id'], self.asr_config)
                    result['transcript'] = job
                if job['status'] == 'ready_for_analysis':
                    version = self.project['artifact_version'] + '-input-' + job['job_id'][4:12]
                    task = self.workflow.prepare(self.run_dir, [job['job_id']], version)
                    if self.analysis_config:
                        task = self.workflow.execute(task['id'], self.analysis_config)
                    result['task'] = task
                with sqlite3.connect(self.workflow.database) as db:
                    db.execute('UPDATE observed_files SET job=? WHERE project=? AND path=? AND fingerprint=?', (job['job_id'], self.project['project_id'], str(resolved), fingerprint))
            except (OSError, ValueError, subprocess.TimeoutExpired) as error:
                result['error'] = str(error)
                with sqlite3.connect(self.workflow.database) as db:
                    db.execute('UPDATE observed_files SET error=? WHERE project=? AND path=? AND fingerprint=?', (str(error), self.project['project_id'], str(resolved), fingerprint))
            results.append(result)
        if self.minutes_query:
            results.extend(self.poll_minutes())
        return results

    def poll_minutes(self):
        current = time.time()
        if self.last_minutes_poll is not None and current - self.last_minutes_poll < self.minutes_interval:
            return []
        self.last_minutes_poll = current
        today = datetime.now(ZoneInfo('Asia/Shanghai')).date()
        arguments = ['minutes', '+search', '--query', self.minutes_query, '--owner-ids', 'me',
                     '--start', (today - timedelta(days=7)).isoformat(), '--end', today.isoformat(), '--page-size', '30']
        results = []
        try:
            while True:
                page = call_cli(arguments)
                for item in page.get('items', []):
                    token = item.get('token') or item.get('minute_token')
                    if not isinstance(token, str):
                        continue
                    with sqlite3.connect(self.workflow.database) as db:
                        db.execute('BEGIN IMMEDIATE')
                        row = db.execute('SELECT status,attempt,pid FROM observed_minutes WHERE project=? AND token=?', (self.project['project_id'], token)).fetchone()
                        if row and row[0] in {'completed', 'failed'}:
                            continue
                        if row and row[0] == 'running' and row[2]:
                            if process_alive(row[2]):
                                continue
                        attempt = (row[1] if row else 0) + 1
                        db.execute('INSERT OR REPLACE INTO observed_minutes (project,token,status,attempt,job,error,pid) VALUES (?,?,?,?,?,?,?)', (self.project['project_id'], token, 'running', attempt, None, None, os.getpid()))
                    try:
                        job = import_minutes(token, self.workflow.workspace, self.project['project_id'])
                        if job['status'] != 'ready_for_analysis':
                            raise ValueError('Minutes transcript was not normalized.')
                        version = self.project['artifact_version'] + '-input-' + job['job_id'][4:12]
                        task = self.workflow.prepare(self.run_dir, [job['job_id']], version)
                        if self.analysis_config:
                            task = self.workflow.execute(task['id'], self.analysis_config)
                        with sqlite3.connect(self.workflow.database) as db:
                            db.execute('UPDATE observed_minutes SET status=?,job=?,error=NULL,pid=NULL WHERE project=? AND token=?', ('completed', job['job_id'], self.project['project_id'], token))
                        results.append({'provider': 'feishu', 'minute_token': token, 'job': job, 'task': task})
                    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
                        waiting = isinstance(error, ConnectorError) and str(error.code) == '2091003'
                        with sqlite3.connect(self.workflow.database) as db:
                            db.execute('UPDATE observed_minutes SET status=?,error=?,pid=NULL WHERE project=? AND token=?', ('waiting_ready' if waiting else 'failed', str(error), self.project['project_id'], token))
                        results.append({'provider': 'feishu', 'minute_token': token, 'status': 'waiting_ready' if waiting else 'failed', 'error': str(error)})
                if not page.get('has_more') or not page.get('page_token'):
                    break
                arguments = [*arguments[:arguments.index('--page-token')], '--page-token', page['page_token']] if '--page-token' in arguments else [*arguments, '--page-token', page['page_token']]
        except (OSError, ValueError, subprocess.TimeoutExpired) as error:
            results.append({'provider': 'feishu', 'error': str(error)})
        return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', type=Path, required=True)
    parser.add_argument('--run-dir', type=Path, required=True)
    parser.add_argument('--input-dir', type=Path, required=True)
    parser.add_argument('--stable-seconds', type=float, default=2)
    parser.add_argument('--asr-config', type=Path)
    parser.add_argument('--analysis-config', type=Path)
    parser.add_argument('--watch', action='store_true')
    parser.add_argument('--minutes-query', help='Explicit project-specific title/content query for owned Minutes')
    parser.add_argument('--minutes-interval', type=float, default=60)
    parser.add_argument('--retry-failed', action='store_true', help='Explicitly retry failed observed inputs on this startup')
    args = parser.parse_args()
    runner = IntakeRunner(args.workspace, args.run_dir, args.input_dir, args.stable_seconds,
                          read_json(args.asr_config) if args.asr_config else None,
                          read_json(args.analysis_config) if args.analysis_config else None, args.minutes_query, args.minutes_interval)
    if args.retry_failed:
        with sqlite3.connect(runner.workflow.database) as db:
            db.execute('UPDATE observed_files SET job=NULL,error=NULL WHERE project=? AND error IS NOT NULL', (runner.project['project_id'],))
            db.execute('UPDATE observed_minutes SET status=?,attempt=0,error=NULL,pid=NULL WHERE project=? AND status=?', ('waiting_ready', runner.project['project_id'], 'failed'))
    try:
        while True:
            print(json.dumps(runner.once(), ensure_ascii=False), flush=True)
            if not args.watch:
                break
            time.sleep(1)
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
