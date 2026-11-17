#!/usr/bin/env python3
"""Normalize UTF-8 text and subtitle files into traceable source segments."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile

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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--project-id', required=True)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if not args.project_id.strip():
        parser.error('project-id must be nonempty')
    if args.input.resolve() == args.output.resolve():
        parser.error('input and output must be different files')
    extension = args.input.suffix.lower()
    if extension not in {'.txt', '.md', '.srt', '.vtt'}:
        parser.error('supported inputs are UTF-8 TXT, Markdown, SRT and VTT')
    try:
        raw = args.input.read_bytes()
        text = raw.decode('utf-8-sig').replace('\r\n', '\n').replace('\r', '\n')
        material_id = hashlib.sha256(raw).hexdigest()
        rows = []
        for index, (body, locator) in enumerate(segments(text, extension in {'.srt', '.vtt'}), 1):
            if not body:
                continue
            identity = f'{args.project_id}\0{material_id}\0{index}'
            rows.append({
                'source_id': 'SRC-' + hashlib.sha256(identity.encode()).hexdigest()[:24],
                'project_id': args.project_id,
                'material_id': material_id,
                'source_name': args.input.name,
                'source_type': 'transcript',
                'text': body,
                'locator': locator,
                'speaker': None,
                'schema_version': '0.1',
            })
        if not rows:
            raise ValueError('Input contains no transcript segments')
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=args.output.parent, delete=False) as output:
                temporary = Path(output.name)
                for row in rows:
                    output.write(json.dumps(row, ensure_ascii=False) + '\n')
            os.replace(temporary, args.output)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
        print(json.dumps({'segments': len(rows), 'output': str(args.output)}, ensure_ascii=False))
    except (OSError, UnicodeError, ValueError) as error:
        parser.exit(1, f'Normalization failed: {error}\n')


if __name__ == '__main__':
    main()
