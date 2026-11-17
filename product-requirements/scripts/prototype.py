#!/usr/bin/env python3
"""Generate a reviewed form/list prototype with local simulated interactions."""
import json
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent.parent


def validate_prototype(project):
    pages = project['pages']
    if not pages:
        raise ValueError('Confirmed page specifications are required.')
    reqs = {item['requirement_id']: item for item in project['requirements']}
    page_ids = {page['page_id'] for page in pages}
    if len(page_ids) != len(pages):
        raise ValueError('Prototype page IDs must be unique.')
    for page in pages:
        if not page['requirement_ids']:
            raise ValueError('Each prototype page must reference its confirmed requirements.')
        for key in page['requirement_ids']:
            req = reqs.get(key)
            if not req or req['review_status'] != 'confirmed' or req.get('lifecycle_status') == 'cancelled' or not req.get('behavior') or not req.get('acceptance_criteria'):
                raise ValueError('Prototype generation requires confirmed behavior and acceptance for ' + key)
        fields = page.get('fields', [])
        if not isinstance(fields, list) or not all(isinstance(field, dict) for field in fields):
            raise ValueError('Prototype fields must be an array of field specifications.')
        identities = set()
        for field in fields:
            identity = field.get('id')
            if not isinstance(identity, str) or not identity or identity in identities or not field.get('label'):
                raise ValueError('Prototype field IDs and labels must be present and unique.')
            identities.add(identity)
            if field.get('type', 'text') not in {'text', 'textarea', 'select', 'email', 'number', 'date', 'checkbox'}:
                raise ValueError('Unsupported prototype field type.')
            if field.get('type') == 'select' and (not isinstance(field.get('options'), list) or not field['options'] or not all(isinstance(option, str) for option in field['options'])):
                raise ValueError('Select fields require explicit string options.')
        actions = page.get('actions')
        if not isinstance(actions, list) or not actions:
            raise ValueError('Define page actions before generating prototype: ' + page['page_id'])
        action_ids = set()
        for action in actions:
            if not isinstance(action, dict):
                raise ValueError('Prototype actions must be objects with explicit behavior.')
            if action.get('id') in action_ids or not isinstance(action.get('id'), str) or not action['id'] or not action.get('label'):
                raise ValueError('Prototype action IDs and labels must be unique.')
            action_ids.add(action['id'])
            if action.get('type') not in {'submit', 'navigate', 'reset'}:
                raise ValueError('Unsupported action behavior. Provide an explicit supported page interaction.')
            if action['type'] == 'navigate' and action.get('target_page_id') not in page_ids:
                raise ValueError('Navigation target is unavailable.')
            if action['type'] == 'submit' and not fields:
                raise ValueError('Submission needs an explicit form specification.')
        if page.get('records_from') and page['records_from'] not in page_ids:
            raise ValueError('Record list references an unknown page.')
        columns = page.get('columns', [])
        if not isinstance(columns, list) or not all(isinstance(column, dict) and isinstance(column.get('id'), str) and column['id'] for column in columns):
            raise ValueError('Prototype columns require an array of column IDs.')
    return pages


def generate_prototype(project, root):
    pages = validate_prototype(project)
    payload = {'name': project.get('name', project['project_id']), 'artifact_version': project['artifact_version'],
               'pages': [{key: page[key] for key in ['page_id', 'name', 'task', 'requirement_ids', 'fields', 'actions', 'records_from', 'columns'] if key in page} for page in pages]}
    template = (PACKAGE / 'assets/prototype-template.html').read_text(encoding='utf-8')
    data = json.dumps(payload, ensure_ascii=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    template = template.replace('__PROTOTYPE_STYLE__', (PACKAGE / 'assets/ui.css').read_text()).replace('__PROTOTYPE_DATA__', data)
    output = Path(root) / 'prototype/index.html'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(template, encoding='utf-8')
    return {'path': 'prototype/index.html', 'generator': 'product-requirements/prototype', 'generator_version': '0.1',
            'validation_results': ['Confirmed requirement scope and page behavior checked', 'Form/list interactions use local simulated state', 'Browser task exercise pending']}
