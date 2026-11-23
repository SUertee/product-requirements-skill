#!/usr/bin/env python3
"""Import a local recording or transcript into a versioned analysis inbox."""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import uuid
from datetime import datetime, timezone

TEXT = {'.txt', '.md', '.srt', '.vtt'}
MEDIA = {'.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.mp4', '.mov', '.webm', '.mkv'}
PROCESSOR = 'intake/0.1'


def file_sha256(path):
    checksum = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            checksum.update(block)
    return checksum.hexdigest()


def read_job(directory):
    return json.loads((directory / 'job.json').read_text(encoding='utf-8'))


def ingest(input_path, workspace, project_id, provenance=None, retry=False, related_job_id=None, *, metadata=None):
    input_path = Path(input_path).resolve(strict=True)
    workspace = Path(workspace).resolve()
    if not project_id.strip():
        raise ValueError('project_id must be nonempty')
    suffix = input_path.suffix.lower()
    if suffix not in TEXT | MEDIA or not input_path.is_file():
        raise ValueError('Unsupported material. Use TXT, MD, SRT, VTT, audio or video.')
    material_id = file_sha256(input_path)
    origin = dict(provenance or {'provider': 'local'})
    if related_job_id:
        if suffix not in TEXT or not re.fullmatch(r'JOB-[a-f0-9]{24}', related_job_id):
            raise ValueError('Only a transcript can be linked to a recording job.')
        related = read_job(workspace / 'jobs' / related_job_id)
        if related['project_id'] != project_id or related['kind'] != 'recording':
            raise ValueError('Choose a recording in this project.')
        origin['related_job_id'] = related_job_id
    identity = '\0'.join([project_id, material_id, suffix, PROCESSOR, json.dumps(origin, sort_keys=True)])
    job_id = 'JOB-' + hashlib.sha256(identity.encode()).hexdigest()[:24]
    jobs = workspace / 'jobs'
    jobs.mkdir(parents=True, exist_ok=True)
    destination = jobs / job_id
    retry_of = None
    if destination.exists():
        previous = read_job(destination)
        if previous['status'] != 'failed' or not retry:
            return previous
        retry_of = previous['job_id']
        job_id = 'JOB-' + hashlib.sha256((identity + str(uuid.uuid4())).encode()).hexdigest()[:24]
        destination = jobs / job_id
    stage = Path(tempfile.mkdtemp(prefix='.intake-', dir=jobs))
    job = {'schema_version': '0.1', 'job_id': job_id, 'project_id': project_id,
           'material_id': material_id, 'name': input_path.name, 'kind': 'transcript' if suffix in TEXT else 'recording',
           'processor_version': PROCESSOR, 'created_at': datetime.now(timezone.utc).isoformat(),
           'stage': 'received', 'status': 'processing', 'provenance': origin, 'files': {}}
    if metadata is not None:
        job['metadata'] = metadata
    if retry_of:
        job['retry_of'] = retry_of
    try:
        saved = stage / ('original' + suffix)
        shutil.copyfile(input_path, saved)
        job['files']['original'] = saved.name
        received = file_sha256(saved)
        if received != material_id:
            job['received_sha256'] = received
            raise ValueError('Input changed during import. Wait for transfer completion and retry the stable file.')
        if suffix in TEXT:
            result = subprocess.run([sys.executable, str(Path(__file__).with_name('normalize_transcript.py')),
                                     '--input', str(saved), '--project-id', project_id,
                                     '--output', str(stage / 'sources.jsonl')], capture_output=True, text=True, timeout=60)
            if result.returncode:
                raise ValueError('Transcript normalization failed. Check UTF-8 encoding and subtitle timestamps.')
            # Keep the original display name while retaining the normalizer's stable IDs.
            rows = [json.loads(line) for line in (stage / 'sources.jsonl').read_text().splitlines()]
            for row in rows:
                row['source_name'] = input_path.name
            (stage / 'sources.jsonl').write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in rows), encoding='utf-8')
            job['files']['sources'] = 'sources.jsonl'
            job.update(stage='normalized', status='ready_for_analysis', source_count=len(rows))
        else:
            ffmpeg = shutil.which('ffmpeg')
            if ffmpeg:
                result = subprocess.run([ffmpeg, '-nostdin', '-v', 'error', '-i', str(saved), '-vn', '-ac', '1', '-ar', '16000', str(stage / 'audio.wav')], capture_output=True, timeout=600)
                if result.returncode or not (stage / 'audio.wav').is_file() or (stage / 'audio.wav').stat().st_size <= 44:
                    (stage / 'audio.wav').unlink(missing_ok=True)
                    raise ValueError('Audio extraction failed. Check that the recording contains a readable audio track.')
                job['files']['audio'] = 'audio.wav'
                job['stage'] = 'audio_ready'
            job['status'] = 'awaiting_transcript'
            job['next_action'] = 'Attach a TXT/SRT/VTT transcript or configure an authorized ASR provider.'
        (stage / 'analysis-request.md').write_text(
            '# 需求分析输入\n\n'
            f'项目 {project_id}\n\n材料 {job_id}\n\n'
            '读取 job.json 与实际来源片段，结合已关联的前情和原需求基线，按主 Skill workflow.md 整理画像、REQ、疑问与模型。'
            '保留原话定位和未知字段，经核对后调用 build_documents.py 生成新的文档与工作台版本。\n', encoding='utf-8')
        job['files']['analysis_request'] = 'analysis-request.md'
        if job['status'] == 'ready_for_analysis':
            job['next_action'] = 'Run the product-requirements Skill using sources.jsonl and the existing baseline.'
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        job.update(status='failed', error=str(error))
    try:
        (stage / 'job.json').write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding='utf-8')
        try:
            os.rename(stage, destination)
        except OSError:
            if destination.is_dir() and (destination / 'job.json').is_file():
                return read_job(destination)
            raise
        return job
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--workspace', type=Path, required=True)
    parser.add_argument('--project-id', required=True)
    parser.add_argument('--related-job', help='Recording job to associate with this transcript.')
    parser.add_argument('--retry', action='store_true', help='Keep a failed attempt and create a new attempt.')
    args = parser.parse_args()
    try:
        result = ingest(args.input, args.workspace, args.project_id, retry=args.retry, related_job_id=args.related_job)
        print(json.dumps(result, ensure_ascii=False))
        if result['status'] == 'failed':
            raise SystemExit(1)
    except (OSError, ValueError) as error:
        parser.exit(1, f'Import failed: {error}\n')


if __name__ == '__main__':
    main()
