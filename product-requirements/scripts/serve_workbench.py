#!/usr/bin/env python3
"""Run the local workbench with a material inbox and version-bound review notes."""
import argparse
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

MAX_UPLOAD = 256 * 1024 * 1024


class ReviewConflict(ValueError):
    pass


class WorkbenchServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, run_dir, workspace):
        self.run_dir = Path(run_dir).resolve(strict=True)
        self.workspace = Path(workspace).resolve()
        self.workspace.mkdir(parents=True, exist_ok=True)
        self.project = json.loads((self.run_dir / 'project.json').read_text(encoding='utf-8'))
        manifest = json.loads((self.run_dir / 'manifest.json').read_text(encoding='utf-8'))
        self.allowed_files = {item['path'] for item in manifest['artifacts']}
        self.allowed_files.add('manifest.json')
        self.database = self.workspace / 'reviews.sqlite3'
        with sqlite3.connect(self.database) as db:
            db.execute('CREATE TABLE IF NOT EXISTS reviews (project TEXT, version TEXT, revision INTEGER, decisions TEXT, PRIMARY KEY(project, version))')
        super().__init__(address, Handler)

    def review(self):
        with sqlite3.connect(self.database) as db:
            row = db.execute('SELECT revision, decisions FROM reviews WHERE project=? AND version=?',
                             (self.project['project_id'], self.project['artifact_version'])).fetchone()
        return {'revision': row[0], 'decisions': json.loads(row[1])} if row else {'revision': 0, 'decisions': []}

    def save_review(self, payload):
        target = payload.get('target')
        allowed = {item['requirement_id'] for item in self.project['requirements']}
        review = json.loads((self.run_dir / 'review.json').read_text(encoding='utf-8'))
        allowed.update(item['target'] for item in review['questions'])
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
                             (self.project['project_id'], self.project['artifact_version'])).fetchone()
            revision, decisions = (row[0], json.loads(row[1])) if row else (0, [])
            if payload.get('revision') != revision:
                raise ReviewConflict('Review changed. Refresh the review record before saving again.')
            decisions.append({'decision_id': str(uuid.uuid4()), 'target': target, 'outcome': payload['outcome'],
                              'comment': comment.strip(), 'reviewer': reviewer.strip() or None,
                              'decided_at': datetime.now(timezone.utc).isoformat(), 'review_stage': 'definition',
                              'artifact_version': self.project['artifact_version']})
            db.execute('INSERT OR REPLACE INTO reviews VALUES (?, ?, ?, ?)',
                       (self.project['project_id'], self.project['artifact_version'], revision + 1, json.dumps(decisions, ensure_ascii=False)))
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
        if file.suffix in {'.md', '.jsonl', '.srt', '.vtt'}:
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
                self.wfile.write(block)
                remaining -= len(block)

    def do_GET(self):
        if not self.valid_request():
            return
        path = unquote(urlparse(self.path).path)
        if path == '/api/status':
            jobs = []
            for file in sorted((self.server.workspace / 'jobs').glob('JOB-*/job.json')):
                job = json.loads(file.read_text(encoding='utf-8'))
                if job['project_id'] == self.server.project['project_id']:
                    jobs.append(job)
            self.json_response({'service': 'product-requirements-workbench/0.1',
                                'project_id': self.server.project['project_id'], 'artifact_version': self.server.project['artifact_version'],
                                'max_upload_bytes': MAX_UPLOAD, 'ffmpeg_available': bool(shutil.which('ffmpeg')),
                                'lark_cli_available': bool(shutil.which('lark-cli')), 'jobs': jobs, 'review': self.server.review()})
            return
        match = re.fullmatch(r'/api/jobs/(JOB-[a-f0-9]{24})/([a-z_]+)', path)
        if match:
            directory = self.server.workspace / 'jobs' / match[1]
            if not (directory / 'job.json').is_file():
                self.json_response({'error': 'Job not found.'}, 404)
                return
            job = read_job(directory)
            file_name = job['files'].get(match[2])
            if job['project_id'] != self.server.project['project_id'] or not file_name or Path(file_name).name != file_name:
                self.json_response({'error': 'Artifact unavailable.'}, 404)
                return
            self.send_file(directory / file_name)
            return
        relative = path.lstrip('/') or 'workbench/index.html'
        file = (self.server.run_dir / relative).resolve()
        if relative not in self.server.allowed_files or not file.is_relative_to(self.server.run_dir):
            self.json_response({'error': 'File unavailable in this run.'}, 404)
            return
        self.send_file(file)

    def do_POST(self):
        if not self.valid_request():
            return
        parsed = urlparse(self.path)
        try:
            length = int(self.headers.get('Content-Length', '0'))
            limit = MAX_UPLOAD if parsed.path == '/api/import' else 20000
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
                    result = ingest(file, self.server.workspace, self.server.project['project_id'], related_job_id=related)
                self.json_response({'job': result}, 201)
                return
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError('Expected a JSON object.')
            if parsed.path == '/api/feishu':
                if not isinstance(payload.get('minutes'), str) or type(payload.get('media', False)) is not bool:
                    raise ValueError('Provide a Minutes URL and media selection.')
                job = import_minutes(payload['minutes'], self.server.workspace, self.server.project['project_id'], payload.get('media', False))
                self.json_response({'job': job}, 201)
            elif parsed.path == '/api/retry':
                job_id = payload.get('job_id', '')
                if not isinstance(job_id, str) or not re.fullmatch(r'JOB-[a-f0-9]{24}', job_id):
                    raise ValueError('Invalid job identifier.')
                directory = self.server.workspace / 'jobs' / job_id
                previous = read_job(directory)
                if previous['project_id'] != self.server.project['project_id'] or previous['status'] != 'failed':
                    raise ValueError('Choose a failed job in this project.')
                original = directory / previous['files']['original']
                result = ingest(original, self.server.workspace, self.server.project['project_id'], previous['provenance'], retry=True)
                self.json_response({'job': result}, 201)
            elif parsed.path == '/api/review':
                self.json_response({'review': self.server.save_review(payload)})
            else:
                self.json_response({'error': 'Unknown endpoint.'}, 404)
        except ReviewConflict as error:
            self.json_response({'error': str(error)}, 409)
        except (OSError, ValueError, TimeoutError, subprocess.TimeoutExpired) as error:
            self.json_response({'error': str(error)}, 400)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-dir', type=Path, required=True)
    parser.add_argument('--workspace', type=Path, required=True)
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    with WorkbenchServer(('127.0.0.1', args.port), args.run_dir, args.workspace) as server:
        print(f'http://127.0.0.1:{server.server_address[1]}/workbench/index.html', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
