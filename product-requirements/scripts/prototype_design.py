#!/usr/bin/env python3
"""Check a host-designed prototype against confirmed FR/NFR and assemble it into the prototype shell.

The host model designs the prototype (positioning, information architecture, pages, sample data and
page markup). This module only validates that contract and builds the self-contained HTML; it does not
invent pages or behaviour.
"""
import argparse
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys

PACKAGE = Path(__file__).resolve().parent.parent
NFR_CATEGORIES = {
    'performance': '性能与数据量', 'security': '权限与安全', 'compatibility': '兼容与设备',
    'reliability': '可靠性与失败处理', 'usability': '易用性', 'accessibility': '无障碍',
    'compliance': '审计与合规', 'other': '其他',
}
DEVICES = {'desktop', 'tablet', 'mobile'}
# Prototype archetypes (原型形态). Each has its own shell layout and build rules in references/prototype.md; all of them
# share the one UI spec in assets/ui.css. Designs written before archetypes existed are treated as workspace.
ARCHETYPES = {'workspace', 'dashboard', 'mobile_app', 'chat', 'website', 'flow'}
STATES = {'empty', 'loading', 'error', 'denied', 'success'}
IDENTITY = re.compile(r'^[a-z][a-z0-9-]{0,47}$')
MAX_PAGE_MARKUP = 200_000
MAX_PAGE_SCRIPT = 100_000
MAX_TOTAL = 2_000_000
BLOCKED_TAGS = {'script', 'iframe', 'frame', 'object', 'embed', 'link', 'base', 'meta', 'style'}
URL_ATTRIBUTES = {'src', 'href', 'action', 'formaction', 'poster', 'srcset', 'data', 'xlink:href'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def text(value):
    return isinstance(value, str) and bool(value.strip())


def id_list(value):
    return isinstance(value, list) and all(text(item) for item in value) and len(set(value)) == len(value)


def validate_nfrs(project, requirement_ids, sources):
    """Structural validation used by build_documents for every project version."""
    nfrs = project.get('nfrs', [])
    require(isinstance(nfrs, list), 'nfrs must be an array')
    seen = set()
    for item in nfrs:
        require(isinstance(item, dict), 'NFR entries must be objects')
        key = item.get('nfr_id')
        require(text(key) and key.startswith('NFR-') and key not in seen, 'NFR IDs must be unique and start with NFR-')
        seen.add(key)
        require(text(item.get('title')) and text(item.get('statement')), key + ' needs a title and statement')
        require(item.get('category') in NFR_CATEGORIES, key + ' has an unknown category')
        require(item.get('evidence_type') in {'explicit', 'inferred', 'suggested', 'unknown'}, key + ' has invalid evidence_type')
        require(item.get('review_status') in {'draft', 'confirmed', 'disputed', 'parked'}, key + ' has invalid review_status')
        refs = item.get('source_refs', [])
        require(id_list(refs) and all(ref in sources for ref in refs), key + ' has invalid source_refs')
        require(item['evidence_type'] == 'unknown' or bool(refs), key + ' needs supporting source_refs')
        require(id_list(item.get('requirement_ids', [])) and all(ref in requirement_ids for ref in item.get('requirement_ids', [])), key + ' has invalid requirement_ids')
        treatment = item.get('prototype_treatment')
        if treatment is not None:
            require(isinstance(treatment, dict) and treatment.get('kind') in {'shown', 'not_applicable'} and text(treatment.get('note')),
                    key + ' prototype_treatment needs kind shown/not_applicable and a note')
    return seen


class MarkupScan(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.reqs, self.nfrs, self.gotos, self.states, self.roles, self.problems = set(), set(), set(), set(), set(), []

    def handle_starttag(self, tag, attrs):
        self.inspect(tag, attrs)

    def handle_startendtag(self, tag, attrs):
        self.inspect(tag, attrs)

    def inspect(self, tag, attrs):
        if tag in BLOCKED_TAGS:
            self.problems.append(f'<{tag}> is not allowed in page markup')
        for name, value in attrs:
            value = value or ''
            if name.startswith('on'):
                self.problems.append(f'inline handler {name} is not allowed; use the page script')
            if name in URL_ATTRIBUTES and re.match(r'^\s*(?:[a-z][a-z0-9+.-]*:|//)', value, re.I) and not value.strip().lower().startswith(('#', 'data:image/')):
                self.problems.append(f'{name}="{value[:60]}" loads an external or scripted resource')
            if name == 'style' and re.search(r'url\s*\(|expression\s*\(', value, re.I):
                self.problems.append('style attribute must not load resources')
            if name == 'data-req':
                self.reqs.update(value.split())
            elif name == 'data-nfr':
                self.nfrs.update(value.split())
            elif name == 'data-goto':
                self.gotos.add(value.strip())
            elif name == 'data-state':
                self.states.add(value.strip())
            elif name == 'data-roles':
                self.roles.update(part.strip() for part in value.split(',') if part.strip())


# Customer feedback goes to a Feishu Base form; the prototype only links to it and pre-fills page context.
FEEDBACK_FORM = re.compile(r'https://[a-z0-9-]+\.(?:feishu\.cn|larksuite\.com)/share/base/(?:form/)?shr[A-Za-z0-9]{10,40}')


def check_design(project):
    """Return (design, report). Raises ValueError when the design cannot be generated."""
    design = project.get('prototype_design')
    require(isinstance(design, dict), 'prototype_design is required for designed prototypes')
    requirements = {item['requirement_id']: item for item in project['requirements']}
    nfrs = {item['nfr_id']: item for item in project.get('nfrs', [])}

    feedback = design.get('feedback_form_url')
    require(feedback is None or (isinstance(feedback, str) and FEEDBACK_FORM.fullmatch(feedback)),
            'feedback_form_url must be a Feishu/Lark Base form share link (https://<tenant>.feishu.cn/share/base/...)')

    positioning = design.get('positioning')
    require(isinstance(positioning, dict) and text(positioning.get('product_type')) and text(positioning.get('main_flow')),
            'positioning needs product_type and main_flow')
    archetype = positioning.get('archetype', 'workspace')
    require(archetype in ARCHETYPES, 'positioning.archetype must be one of ' + ', '.join(sorted(ARCHETYPES)))
    devices = positioning.get('target_devices')
    require(isinstance(devices, list) and devices and set(devices) <= DEVICES, 'positioning.target_devices must use desktop, tablet or mobile')
    global_nfrs = positioning.get('nfr_ids', [])
    require(id_list(global_nfrs), 'positioning.nfr_ids must be a list of NFR IDs')
    for nfr in global_nfrs:
        require(nfr in nfrs and nfrs[nfr].get('review_status') == 'confirmed', f'{nfr} in positioning must be a confirmed NFR')

    roles = design.get('roles', [])
    require(isinstance(roles, list), 'roles must be an array')
    role_ids = set()
    for role in roles:
        require(isinstance(role, dict) and isinstance(role.get('role_id'), str) and IDENTITY.match(role['role_id']) and role['role_id'] not in role_ids and text(role.get('name')),
                'roles need unique lowercase role_id and a name')
        role_ids.add(role['role_id'])

    pages = design.get('pages')
    require(isinstance(pages, list) and pages, 'prototype_design.pages must list at least one page')
    page_ids = []
    for page in pages:
        require(isinstance(page, dict) and isinstance(page.get('page_id'), str) and IDENTITY.match(page['page_id']), 'page_id must be lowercase letters, digits or hyphens')
        require(page['page_id'] not in page_ids, 'Duplicate page_id ' + page['page_id'])
        page_ids.append(page['page_id'])
    require(design.get('start_page_id', page_ids[0]) in page_ids, 'start_page_id must be one of the pages')

    total = 0
    covered_reqs, shown_nfrs, page_reports = set(), set(global_nfrs), []
    for page in pages:
        key = page['page_id']
        require(text(page.get('name')) and text(page.get('purpose')), key + ' needs name and purpose')
        require(page.get('nav', True) in {True, False}, key + ' nav must be true or false')
        reqs, page_nfrs = page.get('requirement_ids', []), page.get('nfr_ids', [])
        require(id_list(reqs) and id_list(page_nfrs), key + ' has invalid requirement_ids or nfr_ids')
        for req in reqs:
            item = requirements.get(req)
            require(item is not None, f'{key} references unknown {req}')
            require(item.get('review_status') == 'confirmed' and item.get('lifecycle_status') != 'cancelled', f'{req} must be confirmed before it appears in the prototype')
            require(text(item.get('acceptance_criteria')) or (isinstance(item.get('acceptance_criteria'), list) and item['acceptance_criteria']),
                    f'{req} needs acceptance criteria before prototyping')
        for nfr in page_nfrs:
            item = nfrs.get(nfr)
            require(item is not None, f'{key} references unknown {nfr}')
            require(item.get('review_status') == 'confirmed', f'{nfr} must be confirmed before it appears in the prototype')
        page_roles = page.get('roles', [])
        require(id_list(page_roles) and set(page_roles) <= role_ids, key + ' has unknown roles')
        states = page.get('states', [])
        require(id_list(states) and set(states) <= STATES, key + ' states must use ' + ', '.join(sorted(STATES)))
        markup, script = page.get('markup'), page.get('script', '')
        require(text(markup) and len(markup) <= MAX_PAGE_MARKUP, key + ' needs markup within the size limit')
        require(isinstance(script, str) and len(script) <= MAX_PAGE_SCRIPT, key + ' script must be text within the size limit')
        require('</script' not in script.lower(), key + ' script must not close the script element')
        css = page.get('css', '')
        require(isinstance(css, str) and len(css) <= MAX_PAGE_SCRIPT and not re.search(r'url\s*\(|@import|expression\s*\(|</style', css, re.I),
                key + ' css must be plain rules without url(), @import or closing tags')
        total += len(markup) + len(script) + len(css)

        scan = MarkupScan()
        scan.feed(markup)
        scan.close()
        require(not scan.problems, f'{key}: ' + '; '.join(dict.fromkeys(scan.problems)))
        missing = [req for req in reqs if req not in scan.reqs]
        require(not missing, f'{key} does not mark {", ".join(missing)} with data-req on the element that implements it')
        missing = [nfr for nfr in page_nfrs if nfr not in scan.nfrs]
        require(not missing, f'{key} does not mark {", ".join(missing)} with data-nfr on the element that shows it')
        stray = sorted((scan.reqs - set(reqs)) | (scan.nfrs - set(page_nfrs)))
        require(not stray, f'{key} marks {", ".join(stray)} that the page does not declare')
        unknown = sorted(scan.gotos - set(page_ids))
        require(not unknown, f'{key} links to unknown pages {", ".join(unknown)}')
        missing = sorted(set(states) - scan.states)
        require(not missing, f'{key} declares states without data-state elements: {", ".join(missing)}')
        require(scan.states <= STATES, f'{key} uses unknown data-state values')
        require(scan.roles <= role_ids, f'{key} uses unknown data-roles values')
        covered_reqs.update(reqs)
        shown_nfrs.update(page_nfrs)
        page_reports.append({'page_id': key, 'name': page['name'], 'requirement_ids': reqs, 'nfr_ids': page_nfrs, 'states': states, 'roles': page_roles})
    require(total <= MAX_TOTAL, 'Prototype pages exceed the total size limit')
    require(json.dumps(design.get('sample_data', {}), ensure_ascii=False).__len__() <= 500_000, 'sample_data exceeds the size limit')

    excluded = design.get('excluded_requirements', [])
    require(isinstance(excluded, list) and all(isinstance(item, dict) and item.get('requirement_id') in requirements and text(item.get('reason')) for item in excluded),
            'excluded_requirements need a known requirement_id and a reason')
    excluded_ids = {item['requirement_id'] for item in excluded}
    in_scope = [key for key, item in requirements.items() if item.get('review_status') == 'confirmed' and item.get('lifecycle_status') != 'cancelled']
    uncovered = [key for key in in_scope if key not in covered_reqs and key not in excluded_ids]
    require(not uncovered, 'Confirmed requirements without a prototype page or exclusion reason: ' + ', '.join(uncovered))

    nfr_rows = []
    for key, item in nfrs.items():
        if item.get('review_status') != 'confirmed':
            continue
        treatment = item.get('prototype_treatment') or {}
        if key in shown_nfrs:
            require(treatment.get('kind') == 'shown', f'{key} appears on a page, set prototype_treatment.kind to shown with a note')
        else:
            require(treatment.get('kind') == 'not_applicable', f'{key} is confirmed but not shown; mark it not_applicable with a reason')
        nfr_rows.append({'nfr_id': key, 'kind': treatment['kind'], 'note': treatment['note']})

    report = {
        'pages': page_reports,
        'requirements': {'in_scope': len(in_scope), 'covered': sorted(covered_reqs), 'excluded': excluded},
        'nfrs': nfr_rows,
        'archetype': archetype,
        'target_devices': devices,
        'global_nfr_ids': global_nfrs,
    }
    return design, report


def build(project, design, report):
    payload = {
        'name': project.get('name', project['project_id']),
        'artifact_version': project['artifact_version'],
        'positioning': design['positioning'],
        'roles': design.get('roles', []),
        'start_page_id': design.get('start_page_id', design['pages'][0]['page_id']),
        'sample_data': design.get('sample_data', {}),
        'pages': [{key: page[key] for key in ['page_id', 'name', 'purpose', 'nav', 'roles', 'states', 'requirement_ids', 'nfr_ids', 'markup', 'script', 'css'] if key in page} for page in design['pages']],
        'requirements': {key: requirement['title'] for key, requirement in ((item['requirement_id'], item) for item in project['requirements'])},
        'nfrs': {item['nfr_id']: item['title'] for item in project.get('nfrs', [])},
    }
    if design.get('feedback_form_url'):
        payload['feedback'] = {'url': design['feedback_form_url'], 'project_id': project['project_id']}
    data = json.dumps(payload, ensure_ascii=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
    template = (PACKAGE / 'assets/prototype-shell.html').read_text(encoding='utf-8')
    return template.replace('__PROTOTYPE_STYLE__', (PACKAGE / 'assets/ui.css').read_text(encoding='utf-8')).replace('__PROTOTYPE_DATA__', data)


def generate_designed_prototype(project, root):
    design, report = check_design(project)
    output = Path(root) / 'prototype/index.html'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(build(project, design, report), encoding='utf-8')
    shown = sum(1 for row in report['nfrs'] if row['kind'] == 'shown')
    return {'path': 'prototype/index.html', 'generator': 'product-requirements/prototype-design', 'generator_version': '0.2', 'coverage': report,
            'validation_results': [
                f"{len(report['pages'])} designed pages checked against confirmed FR/NFR",
                f"Requirements covered {len(report['requirements']['covered'])}/{report['requirements']['in_scope']}, excluded with reason {len(report['requirements']['excluded'])}",
                f"NFR shown {shown}, not applicable {len(report['nfrs']) - shown}",
                'Markup checked for annotations, links, states, roles and external resources',
                'Browser task exercise pending']}


def main():
    parser = argparse.ArgumentParser(description='Check prototype_design in a project.json before generation.')
    parser.add_argument('project', type=Path)
    args = parser.parse_args()
    try:
        _, report = check_design(json.loads(args.project.read_text(encoding='utf-8-sig')))
    except (OSError, ValueError, KeyError, TypeError) as error:
        print('Prototype design check failed: ' + str(error), file=sys.stderr)
        raise SystemExit(1)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
