#!/usr/bin/env python3
"""Run the local workbench with a material inbox and version-bound review notes."""
import argparse
from threading import Thread
from ipaddress import IPv4Address
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import tempfile
from datetime import datetime, timezone
from urllib.parse import parse_qs, unquote, urlparse
import uuid

from ingest_material import ingest, read_job, TEXT, MEDIA
from feishu_connector import import_minutes
from workflow import Workflow, WorkflowConflict
from release_package import build_release
from intake_runner import transcribe
from customer_review import CustomerReviewServer, read_feedback

MAX_UPLOAD = 256 * 1024 * 1024


class ReviewConflict(ValueError):
    pass


class WorkbenchServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, run_dir, workspace, analysis_config=None, asr_config=None):
        self.customer_server = None
        self.analysis_config = analysis_config
        self.asr_config = asr_config
        self.run_dir = Path(run_dir).resolve(strict=True)
        self.workspace = Path(workspace).resolve()
        self.workspace.mkdir(parents=True, exist_ok=True)
        self.project = json.loads((self.run_dir / 'project.json').read_text(encoding='utf-8'))
        manifest = json.loads((self.run_dir / 'manifest.json').read_text(encoding='utf-8'))
        self.allowed_files = {item['path'] for item in manifest['artifacts']}
        self.allowed_files.add('manifest.json')
        self.workflow = Workflow(self.workspace)
        self.database = self.workspace / 'reviews.sqlite3'
        with sqlite3.connect(self.database) as db:
            db.execute('CREATE TABLE IF NOT EXISTS reviews (project TEXT, version TEXT, revision INTEGER, decisions TEXT, PRIMARY KEY(project, version))')
        super().__init__(address, Handler)

    def review(self, project=None):
        project = project or self.project
        with sqlite3.connect(self.database) as db:
            row = db.execute('SELECT revision, decisions FROM reviews WHERE project=? AND version=?',
                             (project['project_id'], project['artifact_version'])).fetchone()
        return {'revision': row[0], 'decisions': json.loads(row[1])} if row else {'revision': 0, 'decisions': []}

    def save_review(self, payload, run_dir=None):
        run_dir = Path(run_dir) if run_dir else self.run_dir
        project = json.loads((run_dir / 'project.json').read_text(encoding='utf-8'))
        target = payload.get('target')
        stage = payload.get('review_stage', 'definition')
        if stage not in {'definition', 'release'}:
            raise ValueError('Choose definition or release review.')
        allowed = {item['requirement_id'] for item in project['requirements']}
        review = json.loads((run_dir / 'review.json').read_text(encoding='utf-8'))
        allowed.update(item['target'] for item in review['questions'])
        if stage == 'release':
            manifest = json.loads((run_dir / 'manifest.json').read_text())
            allowed = {item['path'] for item in manifest['artifacts'] if item['path'].startswith('prototype/') and item['path'].endswith('.html')}
        if not isinstance(target, str) or target not in allowed or payload.get('outcome') not in ['confirmed', 'needs_changes', 'parked']:
            raise ValueError('Choose an existing review target and valid outcome.')
        if not isinstance(target, str):
            raise ValueError('Invalid review target.')
        comment = payload.get('comment', '')
        reviewer = payload.get('reviewer', '')
        if not isinstance(comment, str) or len(comment) > 10000 or not isinstance(reviewer, str) or len(reviewer) > 200:
            raise ValueError('Invalid review comment or reviewer.')
        with sqlite3.connect(self.database) as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT revision, decisions FROM reviews WHERE project=? AND version=?',
                             (project['project_id'], project['artifact_version'])).fetchone()
            revision, decisions = (row[0], json.loads(row[1])) if row else (0, [])
            if payload.get('revision') != revision:
                raise ReviewConflict('Review changed. Refresh the review record before saving again.')
            decisions.append({'decision_id': str(uuid.uuid4()), 'target': target, 'outcome': payload['outcome'],
                              'comment': comment.strip(), 'reviewer': reviewer.strip() or None,
                              'decided_at': datetime.now(timezone.utc).isoformat(), 'review_stage': stage,
                              'artifact_version': project['artifact_version']})
            db.execute('INSERT OR REPLACE INTO reviews VALUES (?, ?, ?, ?)',
                       (project['project_id'], project['artifact_version'], revision + 1, json.dumps(decisions, ensure_ascii=False)))
        return {'revision': revision + 1, 'decisions': decisions}


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(60)

    def log_message(self, *args):
        pass

    def json_response(self, value, status=200):
        raw = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(raw)

    def valid_request(self):
        host = self.headers.get('Host', '')
        port = self.server.server_address[1]
        if host not in {f'127.0.0.1:{port}', f'localhost:{port}'}:
            self.json_response({'error': 'Invalid local Host.'}, 403)
            return False
        if self.command == 'POST':
            origin = self.headers.get('Origin')
            if self.headers.get('X-Workbench-Request') != '1' or (origin and origin != 'http://' + host):
                self.json_response({'error': 'Use the local workbench to submit this request.'}, 403)
                return False
        self.run_dir = self.server.run_dir
        self.project = self.server.project
        selected = self.headers.get('X-Workbench-Run')
        if selected:
            try:
                task = self.server.workflow.task(selected)
                if task['project'] != self.project['project_id'] or task['status'] != 'completed':
                    raise ValueError('This version is unavailable.')
                self.run_dir = Path(task['result_dir'])
                self.project = json.loads((self.run_dir / 'project.json').read_text(encoding='utf-8'))
            except (OSError, ValueError) as error:
                self.json_response({'error': str(error)}, 404)
                return False
        return True

    def send_file(self, file):
        if not file.is_file():
            self.json_response({'error': 'File not found.'}, 404)
            return
        size = file.stat().st_size
        start, end, status = 0, size - 1, 200
        header = self.headers.get('Range')
        if header:
            match = re.fullmatch(r'bytes=(\d+)-(\d*)', header)
            if not match:
                self.json_response({'error': 'Unsupported byte range.'}, 416)
                return
            start = int(match[1])
            end = min(int(match[2]) if match[2] else end, end)
            if start > end:
                self.json_response({'error': 'Range is outside the file.'}, 416)
                return
            status = 206
        self.send_response(status)
        mime = mimetypes.guess_type(file.name)[0] or 'application/octet-stream'
        if file.suffix.lower() in TEXT | {'.jsonl'}:
            mime = 'text/plain; charset=utf-8'
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(max(0, end - start + 1)))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-store')
        if status == 206:
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.end_headers()
        with file.open('rb') as stream:
            stream.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                block = stream.read(min(remaining, 1024 * 1024))
                if not block:
                    break
                try:
                    self.wfile.write(block)
                except (BrokenPipeError, ConnectionResetError):
                    return
                remaining -= len(block)

    def do_GET(self):
        if not self.valid_request():
            return
        path = unquote(urlparse(self.path).path)
        if path == '/api/status':
            jobs = []
            customer_feedback = []
            for file in sorted((self.server.workspace / 'jobs').glob('JOB-*/job.json')):
                job = json.loads(file.read_text(encoding='utf-8'))
                if job['project_id'] == self.project['project_id']:
                    jobs.append(job)
                    origin = job['provenance']
                    # Questionnaire replies belong to the reviewed version; prototype comments are shown for
                    # every version because the customer usually comments on an earlier released prototype.
                    provider = origin.get('provider')
                    if job['status'] == 'ready_for_analysis' and (
                            provider == 'prototype_feedback'
                            or (provider == 'customer_review' and origin.get('artifact_version') == self.project['artifact_version'])):
                        feedback = read_feedback(self.server.workspace, job)
                        customer_feedback.extend(
                            {**answer, 'respondent': answer.get('respondent') or feedback['respondent'], 'job_id': job['job_id'],
                             'source': provider, 'artifact_version': origin.get('artifact_version')}
                            for answer in feedback['answers'] if answer.get('target')
                        )
            releases = []
            for file in sorted((self.server.workspace / 'releases').glob('REL-*/release.json')):
                release = json.loads(file.read_text())
                if release.get('project_id') == self.project['project_id']:
                    releases.append(release)
            self.json_response({
                'service': 'product-requirements-workbench/0.1',
                'project_id': self.project['project_id'],
                'artifact_version': self.project['artifact_version'],
                'max_upload_bytes': MAX_UPLOAD,
                'analysis_configured': self.server.analysis_config is not None,
                'asr_configured': self.server.asr_config is not None,
                'ffmpeg_available': bool(shutil.which('ffmpeg')),
                'lark_cli_available': bool(shutil.which('lark-cli')),
                'jobs': jobs,
                'customer_feedback': customer_feedback,
                'customer_review_enabled': self.server.customer_server is not None,
                'review': self.server.review(self.project),
                'tasks': self.server.workflow.tasks(self.project['project_id']),
                'releases': releases,
            })
            return
        release_match = re.fullmatch(r'/api/releases/(REL-[a-f0-9]{24})/package', path)
        customer_match = re.fullmatch(r'/customer/(REL-[a-f0-9]{24})/(.+)', path)
        if release_match or customer_match:
            match = release_match or customer_match
            directory = self.server.workspace / 'releases' / match[1]
            try:
                metadata = json.loads((directory / 'release.json').read_text())
                if metadata['project_id'] != self.project['project_id']:
                    raise ValueError('Release belongs to another project.')
                if release_match:
                    self.send_file(directory / 'package.zip')
                else:
                    relative = match[2]
                    root = directory / 'package'
                    file = (root / relative).resolve()
                    if relative not in set(metadata['files']) | {'index.html', 'release.json', 'manifest.json'} or not file.is_relative_to(root):
                        raise ValueError('File is outside this customer package.')
                    self.send_file(file)
            except (OSError, ValueError) as error:
                self.json_response({'error': str(error)}, 404)
            return
        task_match = re.fullmatch(r'/api/tasks/(AN-[a-f0-9]{24})/(request|baseline|sources)', path)
        if task_match:
            try:
                task = self.server.workflow.task(task_match[1])
                if task['project'] != self.project['project_id']:
                    raise ValueError('Task belongs to another project.')
                names = {'request': 'request.json', 'baseline': 'baseline.json', 'sources': 'sources.jsonl'}
                self.send_file(Path(task['request_path']).parent / names[task_match[2]])
            except (OSError, ValueError) as error:
                self.json_response({'error': str(error)}, 404)
            return
        version_match = re.fullmatch(r'/versions/(AN-[a-f0-9]{24})/(.+)', path)
        if version_match:
            try:
                task = self.server.workflow.task(version_match[1])
                if task['project'] != self.project['project_id'] or task['status'] != 'completed':
                    raise ValueError('Version unavailable.')
                root = Path(task['result_dir'])
                relative = version_match[2]
                allowed = {item['path'] for item in json.loads((root / 'manifest.json').read_text())['artifacts']}
                allowed.add('manifest.json')
                file = (root / relative).resolve()
                if relative not in allowed or not file.is_relative_to(root):
                    raise ValueError('File unavailable in this version.')
                self.send_file(file)
            except (OSError, ValueError) as error:
                self.json_response({'error': str(error)}, 404)
            return
        match = re.fullmatch(r'/api/jobs/(JOB-[a-f0-9]{24})/([a-z_]+)', path)
        if match:
            directory = self.server.workspace / 'jobs' / match[1]
            if not (directory / 'job.json').is_file():
                self.json_response({'error': 'Job not found.'}, 404)
                return
            job = read_job(directory)
            file_name = job['files'].get(match[2])
            if job['project_id'] != self.project['project_id'] or not file_name or Path(file_name).name != file_name:
                self.json_response({'error': 'Artifact unavailable.'}, 404)
                return
            self.send_file(directory / file_name)
            return
        relative = path.lstrip('/') or 'workbench/index.html'
        file = (self.run_dir / relative).resolve()
        allowed = {item['path'] for item in json.loads((self.run_dir / 'manifest.json').read_text())['artifacts']}
        allowed.add('manifest.json')
        if relative not in allowed or not file.is_relative_to(self.run_dir):
            self.json_response({'error': 'File unavailable in this run.'}, 404)
            return
        self.send_file(file)

    def do_POST(self):
        if not self.valid_request():
            return
        parsed = urlparse(self.path)
        try:
            length = int(self.headers.get('Content-Length', '0'))
            limit = MAX_UPLOAD if parsed.path == '/api/import' else 8 * 1024 * 1024 if parsed.path == '/api/analysis/complete' else 1024 * 1024 if parsed.path == '/api/documents' else 100000
            if length <= 0 or length > limit:
                self.json_response({'error': 'Empty request or upload exceeds the size limit.'}, 413)
                return
            if parsed.path == '/api/import':
                filename = parse_qs(parsed.query).get('filename', [''])[0]
                if not filename or Path(filename).name != filename or '\\' in filename or Path(filename).suffix.lower() not in TEXT | MEDIA:
                    raise ValueError('Choose a supported recording or transcript filename.')
                with tempfile.TemporaryDirectory(prefix='.upload-', dir=self.server.workspace) as temporary:
                    file = Path(temporary) / filename
                    with file.open('wb') as output:
                        remaining = length
                        while remaining:
                            block = self.rfile.read(min(remaining, 1024 * 1024))
                            if not block:
                                raise ValueError('Upload interrupted.')
                            output.write(block)
                            remaining -= len(block)
                    related = parse_qs(parsed.query).get('related_job', [None])[0]
                    result = ingest(file, self.server.workspace, self.project['project_id'], related_job_id=related)
                self.json_response({'job': result}, 201)
                return
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError('Expected a JSON object.')
            if parsed.path == '/api/feishu':
                if not isinstance(payload.get('minutes'), str) or type(payload.get('media', False)) is not bool:
                    raise ValueError('Provide a Minutes URL and media selection.')
                job = import_minutes(payload['minutes'], self.server.workspace, self.project['project_id'], payload.get('media', False))
                self.json_response({'job': job}, 201)
            elif parsed.path == '/api/retry':
                job_id = payload.get('job_id', '')
                if not isinstance(job_id, str) or not re.fullmatch(r'JOB-[a-f0-9]{24}', job_id):
                    raise ValueError('Invalid job identifier.')
                directory = self.server.workspace / 'jobs' / job_id
                previous = read_job(directory)
                if previous['project_id'] != self.project['project_id'] or previous['status'] != 'failed':
                    raise ValueError('Choose a failed job in this project.')
                original = directory / previous['files']['original']
                result = ingest(original, self.server.workspace, self.project['project_id'], previous['provenance'], retry=True)
                self.json_response({'job': result}, 201)
            elif parsed.path == '/api/customer-review':
                if self.server.customer_server is None:
                    raise ValueError('请启动客户复核服务。')
                url = self.server.customer_server.publish(self.project, payload.get('questions'))
                self.json_response({'url': url}, 201)
            elif parsed.path == '/api/review':
                self.json_response({'review': self.server.save_review(payload, self.run_dir)})
            elif parsed.path == '/api/analysis':
                task = self.server.workflow.prepare(self.run_dir, payload.get('job_ids', []), payload.get('version'), payload.get('context_job_ids', []))
                self.json_response({'task': task}, 201)
            elif parsed.path == '/api/transcribe':
                if self.server.asr_config is None:
                    raise ValueError('Configure an authorized ASR adapter in the local runner startup.')
                job_id = payload.get('job_id')
                if not isinstance(job_id, str) or not re.fullmatch(r'JOB-[a-f0-9]{24}', job_id):
                    raise ValueError('Invalid recording job identifier.')
                job = read_job(self.server.workspace / 'jobs' / job_id)
                if job['project_id'] != self.project['project_id']:
                    raise ValueError('Recording belongs to another project.')
                result = transcribe(self.server.workspace, job_id, self.server.asr_config)
                self.json_response({'job': result}, 201)
            elif parsed.path == '/api/analysis/execute':
                if self.server.analysis_config is None:
                    raise ValueError('Configure an analysis host in the local runner startup.')
                task = self.server.workflow.task(payload.get('request_id'))
                if task['project'] != self.project['project_id']:
                    raise ValueError('Task belongs to another project.')
                result = self.server.workflow.execute(task['id'], self.server.analysis_config)
                self.json_response({'task': result})
            elif parsed.path == '/api/analysis/complete':
                task = self.server.workflow.task(payload.get('request_id'))
                if task['project'] != self.project['project_id']:
                    raise ValueError('Task belongs to another project.')
                result = self.server.workflow.complete(task['id'], payload.get('project'))
                self.json_response({'task': result})
            elif parsed.path == '/api/documents':
                task = self.server.workflow.save_document(self.run_dir, payload.get('version'), payload.get('document'), payload.get('content'), payload.get('base_sha256'))
                self.json_response({'task': task}, 201)
            elif parsed.path == '/api/generate':
                task = self.server.workflow.generate(self.run_dir, payload.get('version'), payload.get('kinds'))
                self.json_response({'task': task}, 201)
            elif parsed.path == '/api/release':
                notes = self.server.review(self.project)
                if payload.get('revision') != notes['revision']:
                    raise ReviewConflict('Review changed. Refresh before creating a release.')
                notes.update(project_id=self.project['project_id'], artifact_version=self.project['artifact_version'])
                result = build_release(self.run_dir, self.server.workspace, payload.get('files'), notes)
                self.json_response({'release': result}, 201)
            elif parsed.path == '/api/review/apply':
                notes = self.server.review(self.project)
                if payload.get('revision') != notes['revision']:
                    raise ReviewConflict('Review changed. Refresh before applying decisions.')
                notes.update(project_id=self.project['project_id'], artifact_version=self.project['artifact_version'], review_stage='definition')
                notes['decisions'] = [item for item in notes['decisions'] if item.get('review_stage', 'definition') == 'definition']
                task = self.server.workflow.apply_review(self.run_dir, notes, payload.get('version'), payload.get('changes'))
                self.json_response({'task': task}, 201)
            else:
                self.json_response({'error': 'Unknown endpoint.'}, 404)
        except (ReviewConflict, WorkflowConflict) as error:
            self.json_response({'error': str(error)}, 409)
        except (OSError, ValueError, TimeoutError, subprocess.TimeoutExpired) as error:
            self.json_response({'error': str(error)}, 400)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-dir', type=Path, required=True)
    parser.add_argument('--workspace', type=Path, required=True)
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--analysis-config', type=Path, help='Trusted local host command configuration')
    parser.add_argument('--asr-config', type=Path, help='Authorized ASR command configuration')
    parser.add_argument('--customer-host', type=IPv4Address, help='Reachable IPv4 address for the separate customer review listener')
    parser.add_argument('--customer-port', type=int, default=8766)
    args = parser.parse_args()
    if args.customer_host and args.customer_host.is_unspecified:
        parser.error('Use a specific customer-facing IPv4 address.')
    with WorkbenchServer(('127.0.0.1', args.port), args.run_dir, args.workspace, json.loads(args.analysis_config.read_text()) if args.analysis_config else None, json.loads(args.asr_config.read_text()) if args.asr_config else None) as server:
        customer = None
        if args.customer_host:
            customer = CustomerReviewServer((str(args.customer_host), args.customer_port), server.workspace)
            server.customer_server = customer
            Thread(target=customer.serve_forever, daemon=True).start()
        print(f'http://127.0.0.1:{server.server_address[1]}/workbench/index.html', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            if customer:
                customer.shutdown()
                customer.server_close()


if __name__ == '__main__':
    main()
