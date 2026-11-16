#!/usr/bin/env python3
"""Normalize UTF-8 text and subtitle files into traceable source segments."""
import argparse
import hashlib
import json
from pathlib import Path
import re

from project_lib import stable_id, utc_now, write_jsonl

TIMING = re.compile(
    r'^(?P<start>(?:\d{2}:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+'
    r'(?P<end>(?:\d{2}:)?\d{2}:\d{2}[.,]\d{3})(?:\s+.*)?$'
)


def seconds(value):
    parts = value.replace(',', '.').split(':')
    total = 0.0
    for part in parts:
        total = total * 60 + float(part)
    return round(total, 3)


def segments(text, subtitles):
    blocks = re.split(r'\n\s*\n', text.strip())
    for index, block in enumerate(blocks, 1):
        lines = block.splitlines()
        if not subtitles:
            yield block.strip(), {'paragraph': index}
            continue
        if lines[0].startswith(('WEBVTT', 'NOTE', 'STYLE', 'REGION')):
            continue
        timing_index = next((i for i, line in enumerate(lines) if TIMING.fullmatch(line.strip())), None)
        if timing_index is None:
            raise ValueError(f'Subtitle block {index} has no valid timing line')
        match = TIMING.fullmatch(lines[timing_index].strip())
        start, end = seconds(match['start']), seconds(match['end'])
        if end < start:
            raise ValueError(f'Subtitle block {index} ends before it starts')
        body = '\n'.join(lines[timing_index + 1:]).strip()
        if body:
            yield body, {'start_seconds': start, 'end_seconds': end, 'cue': index}


def normalize(input_path, project_id, meeting_id=None):
    """Return one SourceMaterial and independent TranscriptSegment rows."""
    raw = input_path.read_bytes()
    text = raw.decode('utf-8-sig').replace('\r\n', '\n').replace('\r', '\n')
    file_hash = hashlib.sha256(raw).hexdigest()
    source_id = stable_id('SRC-', project_id, file_hash, length=24)
    meeting_id = meeting_id or stable_id('MEET-', project_id, file_hash, length=16)
    created_at = utc_now()
    material = {
        'schema_version': '1.0',
        'source_id': source_id,
        'project_id': project_id,
        'source_type': 'transcript',
        'file_name': input_path.name,
        'file_hash': file_hash,
        'original_path': str(input_path.resolve()),
        'processing_status': 'normalized',
        'permission_status': 'authorized',
        'created_at': created_at,
        'material_id': file_hash,
        'source_name': input_path.name,
        'meeting_id': meeting_id,
    }
    rows = []
    extension = input_path.suffix.lower()
    for index, (body, locator) in enumerate(segments(text, extension in {'.srt', '.vtt'}), 1):
        if not body:
            continue
        speaker_match = re.match(r'^(Speaker [A-Z])\s*[:：]', body)
        row = {
            'schema_version': '1.0',
            'segment_id': stable_id('SEG-', project_id, file_hash, index, length=24),
            'source_id': source_id,
            'meeting_id': meeting_id,
            'speaker_id': speaker_match.group(1) if speaker_match else 'Speaker Unknown',
            'start_time': locator.get('start_seconds'),
            'end_time': locator.get('end_seconds'),
            'original_text': body,
            'corrected_text': None,
            'confidence': None,
            'paragraph': locator.get('paragraph'),
            'cue': locator.get('cue'),
            # Compatibility with the original v0.1 JSONL consumer contract.
            'project_id': project_id,
            'material_id': file_hash,
            'source_name': input_path.name,
            'source_type': 'transcript',
            'text': body,
            'locator': locator,
            'speaker': speaker_match.group(1) if speaker_match else None,
        }
        rows.append(row)
    if not rows:
        raise ValueError('Input contains no transcript segments')
    return material, rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--project-id', required=True)
    parser.add_argument('--meeting-id')
    parser.add_argument('--output', required=True, type=Path, help='TranscriptSegment JSONL output')
    parser.add_argument('--sources-output', type=Path, help='Optional SourceMaterial JSONL output')
    args = parser.parse_args()
    if not args.project_id.strip():
        parser.error('project-id must be nonempty')
    outputs = [args.output] + ([args.sources_output] if args.sources_output else [])
    if args.input.resolve() in {path.resolve() for path in outputs}:
        parser.error('input and output must be different files')
    if len({path.resolve() for path in outputs}) != len(outputs):
        parser.error('transcript and sources outputs must be different files')
    extension = args.input.suffix.lower()
    if extension not in {'.txt', '.md', '.srt', '.vtt'}:
        parser.error('supported inputs are UTF-8 TXT, Markdown, SRT and VTT')
    try:
        material, rows = normalize(args.input, args.project_id, args.meeting_id)
        write_jsonl(args.output, rows)
        if args.sources_output:
            write_jsonl(args.sources_output, [material])
        print(json.dumps({
            'segments': len(rows), 'source_id': material['source_id'],
            'file_hash': material['file_hash'], 'output': str(args.output),
            'sources_output': str(args.sources_output) if args.sources_output else None,
        }, ensure_ascii=False))
    except (OSError, UnicodeError, ValueError) as error:
        parser.exit(1, f'Normalization failed: {error}\n')


if __name__ == '__main__':
    main()
