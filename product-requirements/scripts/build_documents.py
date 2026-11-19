#!/usr/bin/env python3
"""Validate structured requirements and publish a new reviewable document bundle."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tempfile
from datetime import datetime, timezone

PACKAGE = Path(__file__).resolve().parent.parent
PROFILE = {
    'customer_and_roles': '客户与角色',
    'business_scenario': '业务场景',
    'pain_points': '核心痛点',
    'desired_outcomes': '目标结果',
    'scope': '需求范围',
    'constraints': '约束条件',
    'integrations': '集成与依赖',
    'evidence_and_questions': '证据与待确认',
}
EVIDENCE = {'explicit': '客户表达', 'inferred': '模型推断', 'suggested': '产品建议', 'unknown': '待确认'}
REVIEW = {'draft', 'confirmed', 'disputed', 'parked'}
DETAILS = {
    'role': '角色', 'trigger': '触发条件', 'behavior': '功能行为',
    'inputs': '输入', 'outputs': '输出', 'rules': '业务规则',
    'exceptions': '异常处理', 'acceptance_criteria': '验收标准',
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def readable(value):
    if value is None or value == '' or value == [] or value == {}:
        return '待确认'
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, indent=2)


def literal(value):
    """Keep supplied content from injecting Markdown headings or links."""
    text = readable(value)
    return re.sub(r'([\\`*_{}\[\]<>()#!|>~])', r'\\\1', text)


def document_value(value):
    """Readable Markdown for structured fields, preserving supplied labels and values."""
    if isinstance(value, list) and value:
        return '\n'.join('- ' + document_value(item).replace('\n', '\n  ') for item in value)
    if isinstance(value, dict) and value:
        labels = {
            **PROFILE,
            'module_id': '模块标识', 'name': '名称', 'goal': '目标', 'requirement_ids': '关联需求',
            'entity_id': '实体标识', 'fields': '字段', 'type': '类型', 'relations': '关系',
            'entities': '实体', 'page_id': '页面标识', 'task': '页面任务', 'actions': '操作',
            'label': '标签', 'id': '标识', 'required': '必填', 'primary_key': '主键',
            'nullable': '可空', 'description': '说明', 'method': '方法', 'path': '路径',
            'api_id': '接口标识', 'source_refs': '来源', 'from': '起点', 'to': '终点',
        }
        lines = []
        for key, item in value.items():
            formatted = document_value(item).replace('\n', '\n  ')
            lines.append('- ' + labels.get(key, literal(key)) + ' — ' + formatted)
        return '\n'.join(lines)
    return literal(value)


def read_inputs(project_path, sources_path):
    project = json.loads(project_path.read_text(encoding='utf-8-sig'))
    require(isinstance(project, dict), 'project.json must be an object')
    for key in ['project_id', 'schema_version', 'artifact_version']:
        require(nonempty(project.get(key)), f'{key} must be a nonempty string')
    require(project['schema_version'] == '0.1', 'Supported schema_version is 0.1')
    require(isinstance(project.get('requirement_profile'), dict), 'requirement_profile must be an object')
    require(isinstance(project.get('requirements'), list), 'requirements must be an array')
    for key, expected in [('context_sources', list), ('pages', list), ('business_model', dict), ('design_context', dict)]:
        require(isinstance(project.get(key), expected), f'{key} has an invalid type')
    require('baseline_version' in project, 'baseline_version must be supplied, using null for a new project')
    require(project['baseline_version'] is None or nonempty(project['baseline_version']), 'Invalid baseline_version')
    sources = {}
    for number, line in enumerate(sources_path.read_text(encoding='utf-8-sig').splitlines(), 1):
        if not line.strip():
            continue
        item = json.loads(line)
        require(isinstance(item, dict), f'Source line {number} must be an object')
        source_id = item.get('source_id')
        require(nonempty(source_id) and source_id not in sources, f'Invalid or duplicate source ID on line {number}')
        require(item.get('project_id') == project['project_id'], f'Source {source_id} belongs to a different project')
        require(nonempty(item.get('text')), f'Source {source_id} has no text')
        require(isinstance(item.get('locator'), dict) and bool(item['locator']), f'Source {source_id} has no locator')
        sources[source_id] = item
    require(bool(sources), 'At least one source segment is required')
    requirement_ids = set()
    for index, requirement in enumerate(project['requirements'], 1):
        require(isinstance(requirement, dict), f'Requirement {index} must be an object')
        req_id = requirement.get('requirement_id')
        require(nonempty(req_id) and req_id not in requirement_ids, f'Invalid or duplicate requirement ID at item {index}')
        requirement_ids.add(req_id)
        require(nonempty(requirement.get('title')), f'{req_id} has no title')
        require(requirement.get('evidence_type') in EVIDENCE, f'{req_id} has invalid evidence_type')
        require(requirement.get('review_status') in REVIEW, f'{req_id} has invalid review_status')
        refs = requirement.get('source_refs')
        require(isinstance(refs, list) and all(nonempty(ref) for ref in refs), f'{req_id} has invalid source_refs')
        require(all(ref in sources for ref in refs), f'{req_id} references an unknown source')
        require(requirement['evidence_type'] == 'unknown' or bool(refs), f'{req_id} needs supporting source_refs')
        locks = requirement.get('locked_fields', [])
        require(isinstance(locks, list) and all(nonempty(field) and field in requirement for field in locks), f'{req_id} has invalid locked_fields')
    page_ids = set()
    for page in project['pages']:
        require(isinstance(page, dict), 'Page must be an object')
        page_id = page.get('page_id')
        require(nonempty(page_id) and page_id not in page_ids, 'Page IDs must be unique nonempty strings')
        page_ids.add(page_id)
        refs = page.get('requirement_ids')
        require(isinstance(refs, list) and all(nonempty(ref) and ref in requirement_ids for ref in refs), f'{page_id} has invalid requirement_ids')
    for field, identity in [('modules', 'module_id'), ('apis', 'api_id'), ('meetings', 'meeting_id'), ('materials', 'material_id')]:
        records = project.get(field, [])
        require(isinstance(records, list), f'{field} must be an array')
        identities = set()
        for record in records:
            require(isinstance(record, dict), f'{field} entries must be objects')
            key = record.get(identity)
            require(nonempty(key) and key not in identities, f'{field} identities must be unique nonempty strings')
            identities.add(key)
            if field in {'modules', 'apis'}:
                refs = record.get('requirement_ids', [])
                require(isinstance(refs, list) and all(nonempty(ref) and ref in requirement_ids for ref in refs), f'{key} has invalid requirement_ids')
            if field == 'materials':
                refs = record.get('source_ids', [])
                require(isinstance(refs, list) and all(nonempty(ref) and ref in sources for ref in refs), f'{key} has invalid source_ids')
    material_ids = {item['material_id'] for item in project.get('materials', [])}
    module_ids = {item['module_id'] for item in project.get('modules', [])}
    relations = project.get('module_relations', [])
    require(isinstance(relations, list), 'module_relations must be an array')
    for relation in relations:
        require(isinstance(relation, dict) and relation.get('from') in module_ids and relation.get('to') in module_ids and nonempty(relation.get('label')), 'Module relations require known module IDs and a label')
    material_ids.update(item['material_id'] for item in sources.values() if nonempty(item.get('material_id')))
    for meeting in project.get('meetings', []):
        refs = meeting.get('material_ids', [])
        require(isinstance(refs, list) and all(nonempty(ref) and ref in material_ids for ref in refs), f"{meeting['meeting_id']} has invalid material_ids")
        highlights = meeting.get('highlights', [])
        require(isinstance(highlights, list), 'Meeting highlights must be an array')
        meeting_sources = {key for key, source in sources.items() if source.get('material_id') in refs}
        for material in project.get('materials', []):
            if material['material_id'] in refs:
                meeting_sources.update(material.get('source_ids', []))
        for highlight in highlights:
            require(isinstance(highlight, dict) and nonempty(highlight.get('text')), 'Meeting highlights need text')
            citations = highlight.get('source_refs')
            require(isinstance(citations, list) and bool(citations)
                    and all(isinstance(key, str) and key in meeting_sources for key in citations),
                    'Meeting highlights need sources from the associated meeting materials')
    def check_references(value):
        if isinstance(value, dict):
            if 'source_refs' in value:
                refs = value['source_refs']
                require(isinstance(refs, list) and all(isinstance(key, str) and key in sources for key in refs), 'Nested data references an unknown source')
            if 'requirement_ids' in value:
                refs = value['requirement_ids']
                require(isinstance(refs, list) and all(isinstance(key, str) and key in requirement_ids for key in refs), 'Nested data references an unknown requirement')
            for item in value.values():
                check_references(item)
        elif isinstance(value, list):
            for item in value:
                check_references(item)
    check_references(project)
    for field in ['action_items', 'reported_facts']:
        require(isinstance(project.get(field, []), list), field + ' must be an array')
    return project, sources


def collect_questions(project):
    questions = []
    for key, label in PROFILE.items():
        if readable(project['requirement_profile'].get(key)) == '待确认':
            questions.append({'target': f'requirement_profile.{key}', 'reason': f'{label}缺少资料'})
    for req in project['requirements']:
        for key, label in DETAILS.items():
            if readable(req.get(key)) == '待确认':
                questions.append({'target': req['requirement_id'], 'field': key, 'reason': f'{label}待补全'})
        for question in req.get('open_questions', []):
            questions.append({'target': req['requirement_id'], 'reason': str(question)})
        if req['review_status'] != 'confirmed' or req['evidence_type'] != 'explicit':
            questions.append({'target': req['requirement_id'], 'reason': '核对依据、范围与确认状态'})
    for key in ['business_model', 'pages']:
        if not project[key]:
            questions.append({'target': key, 'reason': '尚未整理，需要补充并评审'})
    if not project['requirements']:
        questions.append({'target': 'requirements', 'reason': '尚无结构化需求'})
    return questions


def render(project, sources, questions, generated_at):
    title = literal(project.get('name', project['project_id']))
    metadata = f"项目 {literal(project['project_id'])} · 版本 {literal(project['artifact_version'])} · 文档状态 草稿\n\n生成时间 {generated_at}，工具 build_documents/0.1，基线 {literal(project['baseline_version'])}。"
    profile = '\n\n'.join(f'### {label}\n\n{document_value(project["requirement_profile"].get(key))}' for key, label in PROFILE.items() if key in ['customer_and_roles', 'business_scenario', 'pain_points'])
    cards = []
    for req in project['requirements']:
        lines = [f"### {literal(req['requirement_id'])} · {literal(req['title'])}",
                 f"依据类型 {EVIDENCE[req['evidence_type']]} · 需求状态 {dict(draft='草稿', confirmed='已确认', disputed='冲突', parked='暂缓')[req['review_status']]}"]
        lines += [f"- {label} — {document_value(req.get(key)).replace(chr(10), chr(10) + '  ')}" for key, label in DETAILS.items()]
        lines.append('- 来源 — ' + '、'.join(literal(ref) for ref in req['source_refs']))
        lines.append('- 人工锁定 — ' + ('、'.join(DETAILS.get(key, literal(key)) for key in req.get('locked_fields', [])) or '无'))
        cards.append(lines[0] + '\n\n' + lines[1] + '\n\n' + '\n'.join(lines[2:]))
    citations = '\n\n'.join(f"### {literal(key)}\n\n定位 {literal(value['locator'])}\n\n{literal(value['text'])}" for key, value in sources.items())
    question_text = '\n'.join(f"- {literal(item['target'])} — {literal(item['reason'])}" for item in questions) or '本轮结构检查未发现待补全字段，整体文档等待人工评审。'
    sections = {
        '文档信息': metadata,
        '背景与问题': profile,
        '目标与范围': document_value({key: project['requirement_profile'].get(key) for key in ['desired_outcomes', 'scope', 'constraints']}),
        '角色与权限': document_value(project['requirement_profile'].get('customer_and_roles')),
        '业务流程与数据模型': document_value({'功能模块': project.get('modules', []), '业务模型': project['business_model']}),
        '功能需求': '\n\n'.join(cards) or '待确认',
        '页面与交互': document_value(project['pages']),
        '质量约束与集成': document_value({key: project['requirement_profile'].get(key) for key in ['constraints', 'integrations']}) + '\n\n' + document_value({'接口草案': project.get('apis', [])}),
        '验收与待确认': question_text + '\n\n' + document_value(project['requirement_profile'].get('evidence_and_questions')),
    }
    template = (PACKAGE / 'assets/prd-template.md').read_text()
    chunks = re.split(r'(?m)^## ', template)
    document = [f'# {title} 产品需求文档']
    for chunk in chunks[1:]:
        heading, _, body = chunk.partition('\n')
        document.append(f'## {heading}\n\n' + sections.get(heading, body.strip()))
    meeting_extras = {key: project[key] for key in ['meeting_type', 'action_items', 'reported_facts'] if project.get(key)}
    if meeting_extras:
        document.append('## 会议补充\n\n' + literal(meeting_extras))
    document.append('## 原始依据\n\n' + citations)
    profile_data = project['requirement_profile']
    proposal_sections = [
        ('项目摘要', document_value(profile_data.get('desired_outcomes'))),
        ('客户背景与问题', '\n\n'.join(
            '### ' + PROFILE[key] + '\n\n' + document_value(profile_data.get(key))
            for key in ['customer_and_roles', 'business_scenario', 'pain_points']
        )),
        ('目标与交付范围', document_value({
            '目标结果': profile_data.get('desired_outcomes'),
            '交付范围': profile_data.get('scope'),
            '成功指标': profile_data.get('success_metrics'),
        })),
        ('解决方案', document_value(project.get('modules', []))
         + '\n\n### 业务数据模型\n\n' + document_value(project['business_model'])),
        ('实施与资源', document_value({
            '实施路线': project.get('implementation_plan'),
            '里程碑': project.get('milestones'),
            '预算与资源': project.get('resources'),
            '约束': profile_data.get('constraints'),
            '外部依赖': profile_data.get('integrations'),
        })),
        ('验收与风险', question_text + '\n\n逐条行为和验收标准见 [PRD](prd.md)。'),
        ('文档信息', metadata),
        ('模板参考', '- [Asana 项目方案指南](https://asana.com/resources/project-proposal)'),
    ]
    proposal_content = dict(proposal_sections)
    proposal_template = (PACKAGE / 'assets/proposal-template.md').read_text()
    proposal_chunks = re.split(r'(?m)^## ', proposal_template)
    proposal_parts = [f'# {title} 项目方案草稿']
    for chunk in proposal_chunks[1:]:
        heading, _, body = chunk.partition('\n')
        proposal_parts.append('## ' + heading + '\n\n' + proposal_content.get(heading, body.strip()))
    proposal = '\n\n'.join(proposal_parts) + '\n'
    if meeting_extras:
        proposal += '\n## 会议行动与陈述\n\n' + document_value(meeting_extras) + '\n'
    return '\n\n'.join(document) + '\n', proposal


def copy_materials(project, materials_root, stage):
    attachments = []
    for item in project.get('materials', []):
        relative = item.get('path')
        if relative is None:
            continue
        require(materials_root is not None, 'Materials with a path require --materials-root')
        require(nonempty(relative) and not any(char in relative for char in ['\\', ':']), 'Invalid material path')
        path = PurePosixPath(relative)
        require(not path.is_absolute() and '..' not in path.parts, 'Material path must stay within materials root')
        root = materials_root.resolve()
        source = (root / relative).resolve()
        require(source.is_relative_to(root) and source.is_file(), f'Material is unavailable within materials root: {relative}')
        require(source.suffix.lower() in {'.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.mp4', '.mov', '.webm', '.mkv', '.srt', '.vtt', '.txt', '.md', '.pdf', '.docx', '.pptx', '.png', '.jpg', '.jpeg', '.webp'}, f'Unsupported material file type: {relative}')
        output = stage / 'materials' / relative
        require(not output.exists(), f'Duplicate material destination: {relative}')
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, output)
        attachments.append({'material_id': item['material_id'], 'path': output.relative_to(stage).as_posix()})
    return attachments


def copy_artifacts(project, sources, artifact_root, records, stage):
    metadata = {}
    if not records:
        return metadata
    require(artifact_root is not None, 'Artifact records require an explicit root')
    root = Path(artifact_root).resolve(strict=True)
    for record in records:
        relative = record.get('path')
        require(nonempty(relative) and not any(char in relative for char in ['\\', ':']), 'Invalid artifact path')
        path = PurePosixPath(relative)
        require(not path.is_absolute() and '..' not in path.parts and path.parts[0] in {'prototype', 'diagrams', 'data-model'}, 'Artifact path must stay in a deliverable directory')
        require(relative not in metadata, 'Duplicate artifact path')
        require(record.get('artifact_version') == project['artifact_version'], 'Artifact version mismatch')
        require(nonempty(record.get('generator')), 'Artifact generator is required')
        refs = record.get('source_ids', [])
        require(isinstance(refs, list) and all(ref in sources for ref in refs), 'Artifact references an unknown source')
        source = (root / relative).resolve()
        require(source.is_relative_to(root) and source.is_file(), 'Artifact is unavailable inside its root')
        require(source.suffix.lower() in {'.html', '.css', '.js', '.json', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.woff2'}, 'Unsupported artifact type')
        output = stage / relative
        require(not output.exists(), 'Artifact destination already exists')
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, output)
        metadata[relative] = record
    available = {file.relative_to(stage).as_posix() for file in stage.rglob('*') if file.is_file()}
    for record in records:
        require(isinstance(record.get('depends_on', []), list) and all(path in available for path in record.get('depends_on', [])), 'Artifact has an unavailable dependency')
    return metadata


def render_workbench(project, sources, review, documents, artifacts, extra=None, module_diagram=None):
    attachments = [{'material_id': item['material_id'], 'path': item['path']} for item in artifacts if item.get('material_id')]
    payload = json.dumps({'project': project, 'sources': list(sources.values()), 'review': review, 'documents': documents, 'artifacts': artifacts, 'attachments': attachments, 'module_diagram': module_diagram, 'diff': (extra or {}).get('diff.json'), 'generation': (extra or {}).get('generation.json')}, ensure_ascii=False)
    payload = payload.replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    values = {
        '__WORKBENCH_STYLE__': (PACKAGE / 'assets/workbench.css').read_text(),
        '__WORKBENCH_DATA__': payload,
        '__WORKBENCH_SCRIPT__': (PACKAGE / 'assets/workbench.js').read_text(),
    }
    template = (PACKAGE / 'assets/workbench-template.html').read_text()
    return re.sub('|'.join(re.escape(key) for key in values), lambda match: values[match.group()], template)


def publish(project, sources, destination, materials_root=None, *, review_data=None, supplementary=None, artifact_root=None, artifact_records=None):
    require(not destination.exists(), 'Output already exists. Choose a new version directory.')
    destination.parent.mkdir(parents=True, exist_ok=True)
    lock = destination.parent / f'.{destination.name}.build.lock'
    descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    stage = None
    try:
        os.close(descriptor)
        require(not destination.exists(), 'Output already exists. Choose a new version directory.')
        stage = Path(tempfile.mkdtemp(prefix=f'.{destination.name}.', dir=destination.parent))
        generated_at = datetime.now(timezone.utc).isoformat()
        questions = collect_questions(project)
        prd, proposal = render(project, sources, questions, generated_at)
        documents = {'proposal.md': proposal, 'prd.md': prd}
        overrides = project.get('document_overrides', {})
        require(isinstance(overrides, dict), 'Document overrides must be an object')
        for name, record in overrides.items():
            require(name in documents and isinstance(record, dict) and nonempty(record.get('content')), 'Invalid document override')
            documents[name] = record['content']
        prd, proposal = documents['prd.md'], documents['proposal.md']
        (stage / 'prd.md').write_text(prd, encoding='utf-8')
        (stage / 'proposal.md').write_text(proposal, encoding='utf-8')
        review = {'project_id': project['project_id'], 'artifact_version': project['artifact_version'], 'review_status': 'draft', 'questions': questions, 'decisions': []}
        if review_data is not None:
            require(review_data.get('project_id') == project['project_id'] and review_data.get('artifact_version') == project['artifact_version'], 'Review project/version mismatch')
            review.update(review_data)
            review['questions'] = questions
        extra = supplementary or {}
        require(set(extra).issubset({'diff.json', 'generation.json', 'definition.json', 'release.json'}), 'Invalid supplementary output filename')
        for name, value in [('project.json', project), ('review.json', review), *extra.items()]:
            (stage / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        (stage / 'sources.jsonl').write_text(''.join(json.dumps(value, ensure_ascii=False) + '\n' for value in sources.values()), encoding='utf-8')
        attachments = copy_materials(project, materials_root, stage)
        material_ids = {item['path']: item['material_id'] for item in attachments}
        artifact_metadata = copy_artifacts(project, sources, artifact_root, artifact_records, stage)
        artifacts = []
        for file in sorted(stage.rglob('*')):
            if not file.is_file():
                continue
            artifacts.append({'path': file.relative_to(stage).as_posix(), 'generation_status': 'success', 'review_status': 'draft', 'artifact_version': project['artifact_version'], 'depends_on': ['project.json', 'sources.jsonl'] if file.suffix == '.md' else [], 'source_ids': list(sources), 'audience': 'internal', 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'generator': 'build_documents/0.1', 'validation_results': ['Input identities and source references checked']})
            record = artifact_metadata.get(file.relative_to(stage).as_posix())
            if record:
                artifacts[-1].update({key: value for key, value in record.items() if key not in {'sha256', 'generation_status', 'review_status', 'audience'}})
                artifacts[-1]['audience'] = 'internal'
            if file.relative_to(stage).as_posix() in material_ids:
                artifacts[-1]['material_id'] = material_ids[file.relative_to(stage).as_posix()]
        workbench = stage / 'workbench/index.html'
        workbench.parent.mkdir()
        module_record = artifact_metadata.get('diagrams/modules.html')
        module_diagram = (stage / 'diagrams/modules.html').read_text(encoding='utf-8') if module_record and module_record.get('generator') == 'Archify' else None
        workbench.write_text(render_workbench(project, sources, review, {'proposal.md': proposal, 'prd.md': prd}, artifacts, extra, module_diagram), encoding='utf-8')
        artifacts.append({'path': 'workbench/index.html', 'generation_status': 'success', 'review_status': 'draft', 'artifact_version': project['artifact_version'], 'depends_on': [item['path'] for item in artifacts], 'source_ids': list(sources), 'audience': 'internal', 'sha256': hashlib.sha256(workbench.read_bytes()).hexdigest(), 'generator': 'build_documents/0.1', 'validation_results': ['Embedded data encoded for inert JSON script']})
        manifest = {'schema_version': '0.1', 'project_id': project['project_id'], 'artifact_version': project['artifact_version'], 'generated_at': generated_at, 'artifacts': artifacts}
        (stage / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        stage.rename(destination)
        stage = None
        return len(questions)
    finally:
        if stage is not None:
            shutil.rmtree(stage)
        lock.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', required=True, type=Path)
    parser.add_argument('--sources', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--materials-root', type=Path, help='Explicit root directory for referenced local materials')
    args = parser.parse_args()
    try:
        project, sources = read_inputs(args.project, args.sources)
        count = publish(project, sources, args.output.resolve(), args.materials_root)
        print(json.dumps({'output': str(args.output), 'review_status': 'draft', 'questions': count}, ensure_ascii=False))
    except (OSError, ValueError, TypeError) as error:
        parser.exit(1, f'Document generation failed: {error}\n')


if __name__ == '__main__':
    main()
