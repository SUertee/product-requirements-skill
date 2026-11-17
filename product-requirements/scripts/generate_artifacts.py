#!/usr/bin/env python3
"""Adapt project evidence to configured diagram skills and registered HTML artifacts."""
from datetime import datetime, timezone
import hashlib
import html
import json
from pathlib import Path
import re
import subprocess

from resolve_capability import resolve


def safe_json(value):
    return json.dumps(value, ensure_ascii=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')


def archify_modules(project, root):
    package = resolve('archify')
    modules = project.get('modules', [])
    if not modules:
        raise ValueError('Define business modules before generating the module map.')
    mapping = {item['module_id']: 'module_' + str(index) for index, item in enumerate(modules)}
    relationships = project.get('module_relations', [])
    for relation in relationships:
        if relation.get('from') not in mapping or relation.get('to') not in mapping or not relation.get('label'):
            raise ValueError('Module relationships require existing module IDs and a label.')
    candidate = {
        'schema_version': 1, 'diagram_type': 'architecture',
        'meta': {'title': '业务模块', 'output': 'diagrams/modules.html', 'locale': 'zh-CN', 'quality_profile': 'standard',
                 'legend': {'entries': {'backend': {'label': '业务模块'}}}},
        'components': [{'id': mapping[item['module_id']], 'type': 'backend', 'label': item.get('name') or item['module_id'],
                        'sublabel': str(len(item.get('requirement_ids', []))) + ' 条需求',
                        'pos': [60 + (index % 3) * 300, 70 + (index // 3) * 200], 'size': [210, 90]}
                       for index, item in enumerate(modules)],
        'connections': [{'id': 'relation_' + str(index), 'from': mapping[item['from']], 'to': mapping[item['to']], 'label': item['label']}
                        for index, item in enumerate(relationships)],
    }
    root = Path(root).resolve()
    (root / 'diagrams').mkdir(parents=True, exist_ok=True)
    source = root / 'modules-input.json'
    source.write_text(json.dumps(candidate, ensure_ascii=False, indent=2), encoding='utf-8')
    receipts = []
    for arguments in [['validate', 'architecture', str(source), '--json'], ['render', 'architecture', str(source), 'diagrams/modules.html'], ['check', 'diagrams/modules.html', '--json']]:
        result = subprocess.run(['node', str(package / 'bin/archify.mjs'), *arguments], cwd=root, capture_output=True, text=True, timeout=120)
        if result.returncode:
            raise ValueError('Module diagram ' + arguments[0] + ' failed: ' + (result.stdout or result.stderr)[-3000:])
        receipts.append({'step': arguments[0], 'stdout': result.stdout[-5000:]})
    (root / 'modules-checks.json').write_text(json.dumps(receipts, ensure_ascii=False, indent=2), encoding='utf-8')
    return {'path': 'diagrams/modules.html', 'generator': 'Archify',
            'generator_version': hashlib.sha256((package / 'SKILL.md').read_bytes()).hexdigest(),
            'validation_results': ['Module identities and explicit relationships checked', 'Archify architecture validate, render and check passed', 'Browser review pending']}


def archify_workflow(project, root, flow_index=0):
    package = resolve('archify')
    flows = project['business_model'].get('flows', [])
    if not isinstance(flows, list) or flow_index >= len(flows) or not isinstance(flows[flow_index], dict):
        raise ValueError('Business flows must contain explicit flow specifications.')
    if not isinstance(flows[flow_index].get('steps'), list) or len(flows[flow_index]['steps']) < 2:
        raise ValueError('At least two evidence-backed ordered flow steps are required.')
    flow = flows[flow_index]
    steps = flow['steps']
    if not all(isinstance(step, dict) for step in steps):
        raise ValueError('Flow steps must be objects with IDs and labels.')
    identities = [step.get('id') for step in steps]
    if any(not isinstance(key, str) or not key for key in identities) or len(set(identities)) != len(steps):
        raise ValueError('Flow step IDs must be unique.')
    req_ids = {item['requirement_id'] for item in project['requirements']}
    for step in steps:
        if not isinstance(step.get('label'), str) or not step['label'].strip() or any(key not in req_ids for key in step.get('requirement_ids', [])):
            raise ValueError('Flow steps need labels and valid requirement references.')
    mapped = {step['id']: 'step_' + str(index) for index, step in enumerate(steps)}
    transitions = flow.get('transitions')
    if transitions is None:
        transitions = [{'from': a['id'], 'to': b['id']} for a, b in zip(steps, steps[1:])]
    if not isinstance(transitions, list) or not all(isinstance(item, dict) for item in transitions):
        raise ValueError('Flow transitions must be an array of explicit endpoints.')
    if any(item.get('from') not in mapped or item.get('to') not in mapped for item in transitions):
        raise ValueError('Flow transition references an unknown step.')
    output_path = 'diagrams/workflow.html' if flow_index == 0 else f'diagrams/workflow-{flow_index + 1}.html'
    candidate = {'schema_version': 2, 'diagram_type': 'workflow',
                 'meta': {'title': flow.get('name') or project.get('name', project['project_id']), 'locale': 'zh-CN', 'quality_profile': 'standard', 'output': output_path, 'legend': {'entries': {'backend': {'label': '业务步骤'}}}},
                 'lanes': [{'id': 'lane_' + str(index), 'label': flow.get('name', '业务流程') + (f' · {index + 1}' if len(steps) > 6 else '')} for index in range((len(steps) + 5) // 6)],
                 'nodes': [{'id': mapped[step['id']], 'lane': 'lane_' + str(index // 6), 'col': index % 6, 'type': 'backend', 'label': step['label']} for index, step in enumerate(steps)],
                 'edges': [{'id': 'edge_' + str(index), 'from': mapped[item['from']], 'to': mapped[item['to']], **({'label': item['label']} if item.get('label') else {})} for index, item in enumerate(transitions)]}
    root = Path(root).resolve()
    (root / 'diagrams').mkdir(parents=True, exist_ok=True)
    source = root / f'workflow-{flow_index + 1}-input.json'
    source.write_text(json.dumps(candidate, ensure_ascii=False, indent=2), encoding='utf-8')
    cli = package / 'bin/archify.mjs'
    receipts = []
    for arguments in [['validate', 'workflow', str(source), '--json'], ['render', 'workflow', str(source), output_path], ['check', output_path, '--json']]:
        result = subprocess.run(['node', str(cli), *arguments], cwd=root, capture_output=True, text=True, timeout=120)
        if result.returncode:
            raise ValueError('Archify ' + arguments[0] + ' failed: ' + (result.stdout or result.stderr)[-3000:])
        receipts.append({'step': arguments[0], 'stdout': result.stdout[-5000:]})
    (root / f'archify-{flow_index + 1}-checks.json').write_text(json.dumps(receipts, ensure_ascii=False, indent=2), encoding='utf-8')
    return {'path': output_path, 'generator': 'Archify', 'generator_version': hashlib.sha256((package / 'SKILL.md').read_bytes()).hexdigest(), 'validation_results': ['Upstream workflow validate, render and artifact check passed', 'Browser visual review pending']}


def schema_canvas(project, root):
    package = resolve('schema-canvas')
    template = (package / 'assets/reference-erd.html').read_text(encoding='utf-8')
    entities = project['business_model'].get('entities', [])
    if not isinstance(entities, list) or not entities or not all(isinstance(entity, dict) for entity in entities):
        raise ValueError('Business entities are required for Schema Canvas.')
    tables = []
    domains = {}
    for entity in entities:
        identity = entity.get('entity_id') or entity.get('name')
        if not isinstance(identity, str) or not identity or any(item['id'] == identity for item in tables):
            raise ValueError('Entity identities must be unique nonempty strings.')
        domain = entity.get('domain') or 'business'
        domains[domain] = entity.get('domain_label') or domain
        columns = []
        entity_fields = entity.get('fields', [])
        if not isinstance(entity_fields, list) or not all(isinstance(field, dict) for field in entity_fields):
            raise ValueError('Entity fields must be an array of field specifications.')
        for field in entity_fields:
            name = field.get('name') or field.get('field_id')
            if not name or any(item['name'] == name for item in columns):
                raise ValueError('Field names must be unique within each entity.')
            markers = [label for key, label in [('primary_key', 'PK'), ('unique', 'UQ'), ('indexed', 'INDEX')] if field.get(key) is True]
            if field.get('nullable') is None:
                markers.append('可空性待确认')
            columns.append({'name': name, 'type': field.get('type') or '待确认', 'nullable': field.get('nullable'), 'markers': markers, 'default': field.get('default') if field.get('default') is not None else '', 'description': field.get('description', '')})
        tables.append({'id': identity, 'domain': domain, 'description': entity.get('description') or '候选业务实体，依据当前需求模型', 'columns': columns, 'compositeUnique': entity.get('composite_unique', [])})
    ids = {table['id']: table for table in tables}
    relations = []
    model_relations = project['business_model'].get('relations', [])
    if not isinstance(model_relations, list) or not all(isinstance(relation, dict) for relation in model_relations):
        raise ValueError('Model relations must be an array of relationship specifications.')
    for relation in model_relations:
        source, target = relation.get('from'), relation.get('to')
        if source not in ids or target not in ids:
            raise ValueError('Relation references an unknown entity.')
        from_field, to_field = relation.get('from_field'), relation.get('to_field')
        if from_field not in {field['name'] for field in ids[source]['columns']} or to_field not in {field['name'] for field in ids[target]['columns']}:
            raise ValueError('Relation references an unknown field.')
        verified_fk = relation.get('kind') == 'foreign_key' and bool(relation.get('database_evidence'))
        relations.append({'from': source, 'to': target, 'fromColumn': from_field, 'toColumn': to_field, 'kind': 'fk' if verified_fk else 'logical', 'cardinality': relation.get('cardinality') or '待确认', 'label': relation.get('label') or ('外键依据已提供' if verified_fk else '候选逻辑关系')})
    positions = {}
    y = 20
    for domain in domains:
        count = sum(table['domain'] == domain for table in tables)
        height = 90 + ((count + 3) // 4) * 92
        positions[domain] = [20, y, 930, height]
        y += height + 25
    height = max(450, y)
    payload = {'tables': tables, 'domains': domains, 'relations': relations,
               'source': 'project.json · ' + project['artifact_version'] + ' · 候选业务数据模型',
               'generatedAt': datetime.now(timezone.utc).isoformat(), 'activeTableCount': len(tables)}
    template = re.sub(r'(<script type="application/json" id="schemaData">).*?(</script>)', lambda match: match[1] + safe_json(payload) + match[2], template, flags=re.S)
    start = template.index('const pos=')
    end = template.index('const byId=', start)
    template = template[:start] + 'const pos=' + safe_json(positions) + ';const grid=' + safe_json({key: 4 for key in domains}) + ';let selected=' + safe_json(tables[0]['id']) + ",domain='all',relatedOnly=false,showLogical=true,query='';" + template[end:]
    template = re.sub(r'<section class="audit">.*?</section>', '', template, flags=re.S)
    title = html.escape(project.get('name', project['project_id']) + ' · 数据模型')
    template = template.replace('FinDesk 数据库关系图', title)
    template = re.sub(r'<title>.*?</title>', '<title>' + title + '</title>', template, count=1, flags=re.S)
    template = re.sub(r'<p class="lead">.*?</p>', '<p class="lead">候选业务模型 · ' + html.escape(project['artifact_version']) + '</p>', template, count=1, flags=re.S)
    template = template.replace('Schema 覆盖', '实体覆盖').replace('当前结构，不包含数据库记录或个人财务数据', '候选模型，字段与关系依据当前项目需求')
    template = template.replace('width:1500px', 'width:1000px').replace('height:1130px', f'height:{height}px').replace('width="1500" height="1130" viewBox="0 0 1500 1130"', f'width="1000" height="{height}" viewBox="0 0 1000 {height}"')
    output = Path(root) / 'data-model/index.html'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(template, encoding='utf-8')
    return {'path': 'data-model/index.html', 'generator': 'Schema Canvas', 'generator_version': hashlib.sha256((package / 'assets/reference-erd.html').read_bytes()).hexdigest(), 'validation_results': ['Entity identities, fields and relation endpoints checked', 'Adapted configured Schema Canvas template', 'Browser visual review pending']}


def generate(project, sources, root, kinds):
    if not isinstance(kinds, list) or not kinds or any(kind not in {'modules', 'workflow', 'erd', 'prototype'} for kind in kinds):
        raise ValueError('Choose modules, workflow, erd or prototype generation.')
    records, results = [], []
    requests = []
    for kind in dict.fromkeys(kinds):
        flows = project['business_model'].get('flows', [])
        indices = range(len(flows)) if kind == 'workflow' and isinstance(flows, list) and flows else [0]
        requests.extend((kind, index) for index in indices)
    for kind, flow_index in requests:
        input_details = {'flow_index': flow_index} if kind == 'workflow' else {}
        try:
            if kind == 'modules':
                record = archify_modules(project, root)
            elif kind == 'workflow':
                record = archify_workflow(project, root, flow_index)
            elif kind == 'erd':
                record = schema_canvas(project, root)
            else:
                from prototype import generate_prototype
                record = generate_prototype(project, root)
            record.update(artifact_version=project['artifact_version'], source_ids=list(sources), depends_on=['project.json', 'sources.jsonl'])
            records.append(record)
            results.append({'capability': kind, **input_details, 'generation_status': 'success', 'path': record['path'], 'validation_results': record['validation_results']})
        except (OSError, ValueError, TypeError, KeyError, subprocess.TimeoutExpired) as error:
            results.append({'capability': kind, **input_details, 'generation_status': 'failed', 'error': str(error)})
    return records, {'project_id': project['project_id'], 'artifact_version': project['artifact_version'], 'results': results}
