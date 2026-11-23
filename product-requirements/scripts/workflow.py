#!/usr/bin/env python3
"""Prepare host analysis tasks and publish validated, immutable project versions."""
import argparse
import copy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import tempfile
import uuid

from build_documents import publish, read_inputs
from ingest_material import file_sha256, read_job
from project_revision import apply_review, differences, digest, reconcile


def now():
    return datetime.now(timezone.utc).isoformat()


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def document_revision(baseline, version, edit):
    project = copy.deepcopy(baseline)
    project.update(artifact_version=version, baseline_version=baseline['artifact_version'])
    project.setdefault('document_overrides', {})[edit['document']] = {
        'content': edit['content'], 'edited_from': baseline['artifact_version'],
        'base_sha256': edit['base_sha256'], 'source_refs': [edit['source_id']],
    }
    return project


class WorkflowConflict(ValueError):
    pass


class Workflow:
    def __init__(self, workspace):
        self.workspace = Path(workspace).resolve()
        self.workspace.mkdir(parents=True, exist_ok=True)
        self.database = self.workspace / 'workflow.sqlite3'
        with sqlite3.connect(self.database) as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, identity TEXT UNIQUE, project TEXT, version TEXT, kind TEXT, status TEXT, attempt INTEGER, pid INTEGER, result_hash TEXT, error TEXT, created TEXT, updated TEXT)')
            db.execute('CREATE UNIQUE INDEX IF NOT EXISTS task_project_version ON tasks(project, version)')
            db.execute('CREATE TABLE IF NOT EXISTS asr_runs (id TEXT PRIMARY KEY, project TEXT, job TEXT, status TEXT, pid INTEGER, attempt INTEGER, transcript TEXT, error TEXT, updated TEXT)')
            if 'execution_token' not in {row[1] for row in db.execute('PRAGMA table_info(tasks)')}:
                db.execute('ALTER TABLE tasks ADD COLUMN execution_token TEXT')

    def task(self, request_id):
        if not isinstance(request_id, str) or not re.fullmatch(r'AN-[a-f0-9]{24}', request_id):
            raise ValueError('Invalid analysis request ID.')
        with sqlite3.connect(self.database) as db:
            db.row_factory = sqlite3.Row
            row = db.execute('SELECT * FROM tasks WHERE id=?', (request_id,)).fetchone()
        if row is None:
            raise ValueError('Analysis task not found.')
        result = dict(row)
        result.pop('execution_token', None)
        result['request_path'] = str(self.workspace / 'analysis' / request_id / 'request.json')
        request = read_json(Path(result['request_path']))
        result['job_ids'] = request.get('job_ids', [])
        if result['status'] == 'completed':
            result['result_dir'] = str(self.workspace / 'versions' / request_id)
            generation = Path(result['result_dir']) / 'generation.json'
            if generation.is_file():
                result['generation_results'] = read_json(generation)['results']
        return result

    def tasks(self, project_id):
        with sqlite3.connect(self.database) as db:
            ids = [row[0] for row in db.execute('SELECT id FROM tasks WHERE project=? ORDER BY created', (project_id,))]
        return [self.task(identity) for identity in ids]

    def prepare(self, run_dir, job_ids, version, context_job_ids=None, review_notes=None, changes=None, generation=None, document_edit=None):
        run = Path(run_dir).resolve(strict=True)
        baseline, baseline_sources = read_inputs(run / 'project.json', run / 'sources.jsonl')
        if not isinstance(version, str) or not version.strip() or version == baseline['artifact_version']:
            raise ValueError('Choose a new artifact version.')
        if not isinstance(job_ids, list) or any(not isinstance(key, str) or not re.fullmatch(r'JOB-[a-f0-9]{24}', key) for key in job_ids):
            raise ValueError('Job IDs must be a list of local intake identifiers.')
        job_ids = sorted(set(job_ids))
        context_ids = context_job_ids or []
        if not isinstance(context_ids, list) or any(key not in job_ids for key in context_ids):
            raise ValueError('Context jobs must be included in the selected jobs.')
        jobs = []
        sources = dict(baseline_sources)
        for key in job_ids:
            directory = self.workspace / 'jobs' / key
            job = read_job(directory)
            if job['project_id'] != baseline['project_id'] or job['status'] != 'ready_for_analysis':
                raise ValueError('Select normalized transcript jobs from this project.')
            for line in (directory / job['files']['sources']).read_text(encoding='utf-8').splitlines():
                source = json.loads(line)
                if source['project_id'] != baseline['project_id']:
                    raise ValueError('Source belongs to a different project.')
                previous = sources.get(source['source_id'])
                if previous is not None:
                    identity_fields = ['project_id', 'material_id', 'text', 'locator', 'speaker', 'schema_version']
                    if any(previous.get(field) != source.get(field) for field in identity_fields):
                        raise ValueError('Source ID collision with a different payload.')
                else:
                    sources[source['source_id']] = source
            jobs.append(job)
        material_jobs = list(jobs)
        for job in jobs:
            related_id = job.get('provenance', {}).get('related_job_id')
            if related_id:
                if not isinstance(related_id, str) or not re.fullmatch(r'JOB-[a-f0-9]{24}', related_id):
                    raise ValueError('Invalid linked recording identifier.')
                recording = read_job(self.workspace / 'jobs' / related_id)
                if recording['project_id'] != baseline['project_id'] or recording['kind'] != 'recording' or recording['status'] == 'failed':
                    raise ValueError('Linked recording must be usable and belong to this project.')
                if all(item['job_id'] != related_id for item in material_jobs):
                    material_jobs.append(recording)
        manual_refs = {}
        effective_manual_refs = {}
        if review_notes is not None:
            revised, _ = apply_review(baseline, review_notes, version, changes)
            revised_reqs = {item['requirement_id']: item for item in revised['requirements']}
            previous_reqs = {item['requirement_id']: item for item in baseline['requirements']}
            for index, change in enumerate(changes or [], 1):
                source_id = 'SRC-' + digest([baseline['project_id'], version, review_notes, change, index])[:24]
                target, field = change['target'], change['field']
                related = [item for item in review_notes['decisions'] if item.get('target') == target]
                sources[source_id] = {'source_id': source_id, 'project_id': baseline['project_id'],
                                      'material_id': digest([review_notes, changes]), 'source_name': '人工评审修订', 'source_type': 'manual_review',
                                      'text': '人工修订建议 · ' + target + ' · ' + field + ' → ' + json.dumps(change['value'], ensure_ascii=False),
                                      'locator': {'entry': index, 'field': field}, 'speaker': next((item.get('reviewer') for item in related if item.get('reviewer')), None), 'schema_version': '0.1'}
                manual_refs.setdefault(target, []).append(source_id)
                if revised_reqs[target].get(field) != previous_reqs[target].get(field):
                    effective_manual_refs.setdefault(target, []).append(source_id)
        if document_edit is not None:
            sources[document_edit['source_id']] = {
                'source_id': document_edit['source_id'], 'project_id': baseline['project_id'],
                'source_type': 'manual_document_edit', 'source_name': '文档正文修订',
                'text': '人工修订 ' + document_edit['document'] + '，正文保存在该版本的 document_overrides。',
                'locator': {'entry': 1, 'document': document_edit['document']},
            }
        identity_data = {'baseline': digest(baseline), 'sources': digest(sources), 'jobs': jobs, 'version': version,
                         'context_ids': sorted(set(context_ids)), 'review_notes': review_notes, 'changes': changes, 'generation': generation}
        if document_edit is not None:
            identity_data['document_edit'] = document_edit
        identity = digest(identity_data)
        request_id = 'AN-' + identity[:24]
        with sqlite3.connect(self.database) as db:
            row = db.execute('SELECT id FROM tasks WHERE identity=?', (identity,)).fetchone()
            if row:
                return self.task(row[0])
            existing = db.execute('SELECT id FROM tasks WHERE project=? AND version=?', (baseline['project_id'], version)).fetchone()
            if existing:
                raise WorkflowConflict('This project version is already reserved for another task.')
        root = self.workspace / 'analysis'
        root.mkdir(exist_ok=True)
        folder = root / request_id
        stage = Path(tempfile.mkdtemp(prefix='.request-', dir=root))
        try:
            write_json(stage / 'baseline.json', baseline)
            (stage / 'sources.jsonl').write_text(''.join(json.dumps(source, ensure_ascii=False) + '\n' for source in sources.values()), encoding='utf-8')
            materials = copy.deepcopy(baseline.get('materials', []))
            material_ids = {item['material_id'] for item in materials}
            material_root = stage / 'materials'
            material_root.mkdir()
            for material in materials:
                relative = material.get('path')
                if relative:
                    source = (run / 'materials' / relative).resolve()
                    if not source.is_relative_to(run / 'materials') or not source.is_file():
                        raise ValueError('Baseline material is unavailable in its run directory.')
                    destination = material_root / relative
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(source, destination)
            context = copy.deepcopy(baseline['context_sources'])
            for job in material_jobs:
                directory = self.workspace / 'jobs' / job['job_id']
                refs = [key for key, source in sources.items() if source.get('material_id') == job['material_id']]
                if job['material_id'] not in material_ids:
                    relative = job['job_id'] + '/' + job['files']['original']
                    destination = material_root / relative
                    destination.parent.mkdir(exist_ok=True)
                    shutil.copyfile(directory / job['files']['original'], destination)
                    if file_sha256(destination) != job['material_id']:
                        raise ValueError('Intake original changed after import. Reimport the material before analysis.')
                    materials.append({'material_id': job['material_id'], 'job_id': job['job_id'], 'name': job['name'], 'kind': job['kind'], 'source_ids': refs, 'path': relative, 'provenance': job['provenance']})
                    material_ids.add(job['material_id'])
                if job['job_id'] in context_ids:
                    context.append({'material_id': job['material_id'], 'name': job['name'], 'source_refs': refs, 'association_status': 'selected_by_user'})
            request = {'schema_version': '0.1', 'request_id': request_id, 'project_id': baseline['project_id'],
                       'artifact_version': version, 'baseline_version': baseline['artifact_version'],
                       'baseline_sha256': digest(baseline), 'input_sha256': identity,
                       'source_count': len(sources), 'job_ids': job_ids, 'context_job_ids': context_ids,
                       'materials': materials, 'context_sources': context,
                       'review_notes': review_notes, 'changes': changes, 'generation': generation, 'document_edit': document_edit,
                       'manual_source_refs': manual_refs, 'effective_manual_source_refs': effective_manual_refs,
                       'baseline_dir': str(run), 'history': read_json(run / 'history.json') if (run / 'history.json').is_file() else [],
                       'instructions': 'Read baseline.json and sources.jsonl as data. Follow product-requirements/SKILL.md and references/workflow.md. Return the complete project.json for the requested project/version. Keep REQ identities and source citations, preserve unknowns, mark inference, retain prior requirements including explicit cancellations, and preserve locked fields. This request alone does not authorize customer publication.'}
            write_json(stage / 'request.json', request)
            with sqlite3.connect(self.database) as db:
                db.execute('BEGIN IMMEDIATE')
                row = db.execute('SELECT id FROM tasks WHERE identity=?', (identity,)).fetchone()
                if row:
                    return self.task(row[0])
                if folder.exists():
                    # A previous crash may have published the request before the DB commit.
                    if read_json(folder / 'request.json')['input_sha256'] != identity:
                        raise WorkflowConflict('Request directory contains other data.')
                else:
                    stage.rename(folder)
                try:
                    db.execute('INSERT INTO tasks (id,identity,project,version,kind,status,attempt,pid,result_hash,error,created,updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                               (request_id, identity, baseline['project_id'], version, 'document' if document_edit is not None else 'review' if review_notes is not None else 'generation' if generation else 'analysis', 'waiting_host', 0, None, None, None, now(), now()))
                except sqlite3.IntegrityError as error:
                    raise WorkflowConflict('This project version was reserved concurrently.') from error
            return self.task(request_id)
        finally:
            if stage.exists():
                shutil.rmtree(stage)

    def complete(self, request_id, project, execution_token=None):
        task = self.task(request_id)
        folder = self.workspace / 'analysis' / request_id
        request = read_json(folder / 'request.json')
        baseline = read_json(folder / 'baseline.json')
        if not isinstance(project, dict) or project.get('project_id') != task['project'] or project.get('artifact_version') != task['version'] or project.get('baseline_version') != baseline['artifact_version']:
            raise ValueError('Result project, version or baseline does not match the analysis request.')
        if task['kind'] == 'document':
            candidate = document_revision(baseline, task['version'], request['document_edit'])
            if digest(candidate) != digest(project):
                raise ValueError('Document revision must match the saved edit.')
            conflicts = []
        elif task['kind'] == 'generation':
            candidate = copy.deepcopy(baseline)
            candidate.update(artifact_version=task['version'], baseline_version=baseline['artifact_version'])
            if digest(candidate) != digest(project):
                raise ValueError('Generation must use the selected baseline without modifying requirements.')
            conflicts = []
        elif task['kind'] == 'review':
            candidate, review_diff = apply_review(baseline, request['review_notes'], task['version'], request['changes'])
            if digest(candidate) != digest(project):
                raise ValueError('Review result does not match the recorded decisions and changes.')
            conflicts = review_diff['conflicts']
            for requirement in candidate['requirements']:
                if 'source_refs' not in requirement.get('locked_fields', []):
                    requirement['source_refs'] = list(dict.fromkeys(requirement['source_refs'] + request.get('effective_manual_source_refs', {}).get(requirement['requirement_id'], [])))
            candidate['review_lineage']['source_refs'] = [ref for refs in request.get('manual_source_refs', {}).values() for ref in refs]
            for conflict in conflicts:
                conflict['source_refs'] = request.get('manual_source_refs', {}).get(conflict['target'], [])
        else:
            candidate, conflicts = reconcile(baseline, project)
        candidate['materials'] = request['materials']
        candidate['context_sources'] = request['context_sources']
        result_hash = digest(candidate)
        with sqlite3.connect(self.database) as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT status, pid, result_hash, execution_token FROM tasks WHERE id=?', (request_id,)).fetchone()
            if row[0] == 'completed':
                if row[2] != result_hash:
                    raise WorkflowConflict('This task already completed with a different result.')
                return self.task(request_id)
            owns_execution = execution_token is not None and row[3] == execution_token
            if row[0] == 'running' and not owns_execution:
                try:
                    os.kill(row[1], 0)
                except ProcessLookupError:
                    pass
                else:
                    raise WorkflowConflict('This analysis result is being published.')
            if not owns_execution:
                db.execute('UPDATE tasks SET status=?, attempt=attempt+1, pid=?, error=NULL, updated=? WHERE id=?', ('running', os.getpid(), now(), request_id))
        destination = self.workspace / 'versions' / request_id
        try:
            candidate_file = folder / ('candidate-' + uuid.uuid4().hex + '.json')
            write_json(candidate_file, candidate)
            try:
                checked, sources = read_inputs(candidate_file, folder / 'sources.jsonl')
            finally:
                candidate_file.unlink(missing_ok=True)
            diff = differences(baseline, checked, conflicts)
            review = None
            if request['review_notes'] is not None:
                review = {'project_id': checked['project_id'], 'artifact_version': checked['artifact_version'], 'review_status': 'draft',
                          'decisions': request['review_notes']['decisions'], 'source_version': baseline['artifact_version']}
            if destination.exists():
                if digest(read_json(destination / 'project.json')) != result_hash:
                    raise WorkflowConflict('Published version exists with different data.')
            else:
                extra = {'diff.json': diff}
                records = []
                artifact_root = None
                if request.get('generation'):
                    artifact_root = folder / ('artifacts-' + uuid.uuid4().hex)
                    artifact_root.mkdir()
                    records, extra['generation.json'] = build_artifacts(checked, sources, artifact_root, request, baseline)
                extra['history.json'] = request.get('history', []) + [history_entry(task['kind'], checked, request, diff, extra.get('generation.json'))]
                publish(checked, sources, destination, folder / 'materials', review_data=review, supplementary=extra, artifact_root=artifact_root, artifact_records=records)
            with sqlite3.connect(self.database) as db:
                db.execute('UPDATE tasks SET status=?, result_hash=?, pid=NULL, execution_token=NULL, error=NULL, updated=? WHERE id=?', ('completed', result_hash, now(), request_id))
            return self.task(request_id)
        except Exception as error:
            with sqlite3.connect(self.database) as db:
                db.execute('UPDATE tasks SET status=?, pid=NULL, execution_token=NULL, error=?, updated=? WHERE id=?', ('failed', str(error), now(), request_id))
            raise

    def execute(self, request_id, configuration):
        task = self.task(request_id)
        if task['kind'] != 'analysis':
            raise ValueError('Host execution accepts analysis tasks.')
        argv = configuration.get('argv')
        if not isinstance(argv, list) or not argv or not all(isinstance(item, str) and item for item in argv):
            raise ValueError('Configure the host command as a nonempty argv array.')
        token = uuid.uuid4().hex
        with sqlite3.connect(self.database) as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT status, pid FROM tasks WHERE id=?', (request_id,)).fetchone()
            if row[0] == 'completed':
                return self.task(request_id)
            if row[0] == 'running':
                try:
                    os.kill(row[1], 0)
                except ProcessLookupError:
                    pass
                else:
                    raise WorkflowConflict('This task already has a running host.')
            db.execute('UPDATE tasks SET status=?, attempt=attempt+1, pid=?, execution_token=?, error=NULL, updated=? WHERE id=?', ('running', os.getpid(), token, now(), request_id))
        folder = Path(task['request_path']).parent
        try:
            payload = {'request': read_json(folder / 'request.json'), 'baseline': read_json(folder / 'baseline.json'),
                       'sources': [json.loads(line) for line in (folder / 'sources.jsonl').read_text().splitlines()]}
            result = subprocess.run(argv, input=json.dumps(payload, ensure_ascii=False), capture_output=True, text=True, cwd=folder, timeout=configuration.get('timeout_seconds', 600))
            if result.returncode:
                raise ValueError('Configured analysis host exited with code ' + str(result.returncode))
            candidate = json.loads(result.stdout)
            write_json(folder / 'host-receipt.json', {'provider': configuration.get('provider', 'unknown'), 'model': configuration.get('model', 'unknown'),
                                                    'command_sha256': digest(argv), 'request_id': request_id, 'completed_at': now()})
            return self.complete(request_id, candidate, execution_token=token)
        except Exception as error:
            with sqlite3.connect(self.database) as db:
                db.execute('UPDATE tasks SET status=?, pid=NULL, execution_token=NULL, error=?, updated=? WHERE id=? AND execution_token=?', ('failed', 'Configured analysis host timed out.' if isinstance(error, subprocess.TimeoutExpired) else str(error), now(), request_id, token))
            if isinstance(error, subprocess.TimeoutExpired):
                raise ValueError('Configured analysis host timed out.') from None
            raise

    def save_document(self, run_dir, version, document, content, base_sha256):
        if document not in {'proposal.md', 'prd.md'}:
            raise ValueError('Choose proposal.md or prd.md.')
        if not isinstance(content, str) or not content.strip() or len(content.encode('utf-8')) > 512 * 1024:
            raise ValueError('Document content must be nonempty and within 512 KiB.')
        run = Path(run_dir).resolve(strict=True)
        if not isinstance(base_sha256, str) or file_sha256(run / document) != base_sha256:
            raise WorkflowConflict('Document baseline changed. Reopen the selected version before saving.')
        baseline = read_json(run / 'project.json')
        edit = {'document': document, 'content': content, 'base_sha256': base_sha256,
                'source_id': 'SRC-DOC-' + digest([baseline['project_id'], version, document, content])[:24]}
        task = self.prepare(run, [], version, generation=retained_generation(run), document_edit=edit)
        return self.complete(task['id'], document_revision(baseline, version, edit))

    def generate(self, run_dir, version, kinds):
        if not isinstance(kinds, list) or not kinds or any(kind not in {'modules', 'architecture', 'workflow', 'erd', 'prototype'} for kind in kinds):
            raise ValueError('Choose modules, architecture, workflow, erd or prototype generation.')
        baseline = read_json(Path(run_dir) / 'project.json')
        kinds = list(dict.fromkeys([*kinds, *retained_generation(run_dir)]))
        project = copy.deepcopy(baseline)
        project.update(artifact_version=version, baseline_version=baseline['artifact_version'])
        task = self.prepare(run_dir, [], version, generation=kinds)
        return self.complete(task['id'], project)

    def apply_review(self, run_dir, notes, version, changes=None):
        baseline = read_json(Path(run_dir) / 'project.json')
        result, _ = apply_review(baseline, notes, version, changes)
        # Applying verdicts must not drop the diagrams / prototype the reviewed version already had.
        task = self.prepare(run_dir, [], version, review_notes=notes, changes=changes, generation=retained_generation(Path(run_dir)))
        return self.complete(task['id'], result)


# What each diagram is drawn from. When none of it changed, the new version reuses the previous file instead of
# re-running Archify / Schema Canvas (review statuses and locks do not change a diagram).
ARTIFACT_INPUTS = {
    'architecture': lambda p: [p.get('name'), p.get('technical_architecture')],
    'modules': lambda p: [p.get('name'), p.get('modules'), p.get('module_relations'), [(r.get('requirement_id'), r.get('title')) for r in p.get('requirements', [])]],
    'erd': lambda p: [p.get('name'), (p.get('business_model') or {}).get('entities'), (p.get('business_model') or {}).get('relations')],
}  # the prototype is cheap to rebuild and prints its own version, so it is always regenerated


def build_artifacts(project, sources, root, request, baseline):
    """Generate the requested artifacts, reusing the baseline's file for any whose inputs are unchanged."""
    from generate_artifacts import generate
    previous_dir = Path(request.get('baseline_dir') or '')
    previous = read_json(previous_dir / 'generation.json')['results'] if (previous_dir / 'generation.json').is_file() else []
    manifest = {item['path']: item for item in read_json(previous_dir / 'manifest.json')['artifacts']} if (previous_dir / 'manifest.json').is_file() else {}
    reused_records, reused_results, fresh = [], [], []
    for kind in request['generation']:
        prior = next((item for item in previous if item.get('capability') == kind and item.get('generation_status') == 'success'), None)
        same = kind in ARTIFACT_INPUTS and prior and digest(ARTIFACT_INPUTS[kind](project)) == digest(ARTIFACT_INPUTS[kind](baseline))
        if same and (previous_dir / prior['path']).is_file() and prior['path'] in manifest:
            target = Path(root) / prior['path']
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(previous_dir / prior['path'], target)
            note = '沿用 ' + baseline['artifact_version'] + ' 的结果：生成依据没有变化'
            record = {key: value for key, value in manifest[prior['path']].items() if key not in {'sha256', 'generation_status', 'review_status', 'audience', 'artifact_version'}}
            record.update(artifact_version=project['artifact_version'], source_ids=list(sources), reused_from=baseline['artifact_version'], validation_results=[note, *prior.get('validation_results', [])])
            reused_records.append(record)
            reused_results.append({**prior, 'reused_from': baseline['artifact_version'], 'validation_results': record['validation_results']})
        else:
            fresh.append(kind)
    records, summary = generate(project, sources, root, fresh) if fresh else ([], {'project_id': project['project_id'], 'artifact_version': project['artifact_version'], 'results': []})
    summary['results'] = reused_results + summary['results']
    return reused_records + records, summary


def history_entry(kind, project, request, diff, generation):
    """One line of the version history: how this version was made and from which decisions."""
    decisions = (request.get('review_notes') or {}).get('decisions') or []
    return {'version': project['artifact_version'], 'baseline_version': request['baseline_version'], 'kind': kind, 'created': now(),
            'changes': len(diff.get('changes', [])), 'conflicts': len(diff.get('conflicts', [])),
            'decisions': [{key: item.get(key) for key in ('target', 'outcome', 'comment', 'reviewer', 'decided_at', 'created_at') if item.get(key) not in (None, '')} for item in decisions],
            'document': (request.get('document_edit') or {}).get('document'),
            'generated': [{'capability': item['capability'], 'status': item['generation_status'], **({'reused_from': item['reused_from']} if item.get('reused_from') else {})} for item in (generation or {}).get('results', [])]}


def retained_generation(run):
    """Artifacts the given version generated successfully; a derived version regenerates them from its own data."""
    previous = Path(run) / 'generation.json'
    if not previous.is_file():
        return []
    return list(dict.fromkeys(item['capability'] for item in read_json(previous).get('results', [])
                              if item.get('generation_status') == 'success' and item.get('capability') in {'modules', 'architecture', 'workflow', 'erd', 'prototype'}))


def initialize(project_id, name, destination):
    if not isinstance(project_id, str) or not project_id.strip() or not isinstance(name, str) or not name.strip():
        raise ValueError('Project ID and name are required.')
    project = {'project_id': project_id, 'name': name, 'schema_version': '0.1', 'artifact_version': 'v0', 'baseline_version': None,
               'context_sources': [], 'requirement_profile': {}, 'requirements': [], 'business_model': {}, 'pages': [],
               'design_context': {'design_system_version': '0.2'}}
    identity = 'META-' + digest([project_id, name])[:24]
    source = {'source_id': identity, 'project_id': project_id, 'source_type': 'project_metadata', 'source_name': '项目初始化元数据',
              'text': '用户创建项目 · ' + name, 'locator': {'entry': 1}, 'speaker': None, 'schema_version': '0.1'}
    publish(project, {identity: source}, Path(destination).resolve())
    return {'project_id': project_id, 'artifact_version': 'v0', 'run_dir': str(Path(destination).resolve())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', type=Path, required=True)
    commands = parser.add_subparsers(dest='action', required=True)
    initial = commands.add_parser('init')
    initial.add_argument('--project-id', required=True)
    initial.add_argument('--name', required=True)
    initial.add_argument('--output', type=Path, required=True)
    prepare = commands.add_parser('prepare')
    prepare.add_argument('--run-dir', type=Path, required=True)
    prepare.add_argument('--job', action='append', default=[])
    prepare.add_argument('--context-job', action='append', default=[])
    prepare.add_argument('--version', required=True)
    complete = commands.add_parser('complete')
    complete.add_argument('--request-id', required=True)
    complete.add_argument('--project', type=Path, required=True)
    review = commands.add_parser('apply-review')
    review.add_argument('--run-dir', type=Path, required=True)
    review.add_argument('--notes', type=Path, required=True)
    review.add_argument('--changes', type=Path)
    review.add_argument('--version', required=True)
    generation = commands.add_parser('generate')
    generation.add_argument('--run-dir', type=Path, required=True)
    generation.add_argument('--version', required=True)
    generation.add_argument('--kind', choices=['modules', 'architecture', 'workflow', 'erd', 'prototype'], action='append', required=True)
    execute = commands.add_parser('execute')
    execute.add_argument('--request-id', required=True)
    execute.add_argument('--command-config', type=Path, required=True)
    release = commands.add_parser('release')
    release.add_argument('--run-dir', type=Path, required=True)
    release.add_argument('--notes', type=Path, required=True)
    release.add_argument('--file', action='append', required=True)
    commands.add_parser('list').add_argument('--project-id', required=True)
    args = parser.parse_args()
    workflow = Workflow(args.workspace)
    try:
        if args.action == 'init':
            result = initialize(args.project_id, args.name, args.output)
        elif args.action == 'prepare':
            result = workflow.prepare(args.run_dir, args.job, args.version, args.context_job)
        elif args.action == 'complete':
            result = workflow.complete(args.request_id, read_json(args.project))
        elif args.action == 'apply-review':
            result = workflow.apply_review(args.run_dir, read_json(args.notes), args.version, read_json(args.changes) if args.changes else None)
        elif args.action == 'generate':
            result = workflow.generate(args.run_dir, args.version, args.kind)
        elif args.action == 'execute':
            result = workflow.execute(args.request_id, read_json(args.command_config))
        elif args.action == 'release':
            from release_package import build_release
            result = build_release(args.run_dir, args.workspace, args.file, read_json(args.notes))
        else:
            result = workflow.tasks(args.project_id)
        print(json.dumps(result, ensure_ascii=False))
    except (OSError, ValueError, TypeError) as error:
        parser.exit(1, f'Workflow failed: {error}\n')


if __name__ == '__main__':
    main()
