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
# Back-office archetypes keep the dark navigation; customer-facing ones default to a light bar.
DARK_NAV = {'workspace', 'dashboard'}
HEX = re.compile(r'^#[0-9a-fA-F]{6}$')


def _rgb(value):
    return tuple(int(value[index:index + 2], 16) for index in (1, 3, 5))


def _hex(rgb):
    return '#' + ''.join(f'{round(max(0, min(255, part))):02x}' for part in rgb)


def _mix(colour, other, amount):
    return tuple(a + (b - a) * amount for a, b in zip(colour, other))


def _contrast(first, second):
    def luminance(rgb):
        parts = [(part / 255) / 12.92 if part / 255 <= 0.03928 else ((part / 255 + 0.055) / 1.055) ** 2.4 for part in rgb]
        return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2]
    light, dark = sorted([luminance(first), luminance(second)], reverse=True)
    return (light + 0.05) / (dark + 0.05)


def rigid_layout(css):
    """A layout that cannot fit a 390px phone: three or more fixed grid columns or a fixed width of 400px or more,
    with no media query in the page css to change it. Returns the offending declaration, or None."""
    if '@media' in css:
        return None
    for value in re.findall(r'grid-template-columns\s*:\s*([^;}]+)', css, re.I):
        if 'auto-fit' in value or 'auto-fill' in value:
            continue
        count = re.match(r'\s*repeat\(\s*(\d+)', value)
        tracks = int(count[1]) if count else len(re.findall(r'minmax\([^)]*\)|[^\s()]+(?:\([^)]*\))?', value.strip()))
        if tracks >= 3:
            return 'grid-template-columns: ' + value.strip()
    for prop, number in re.findall(r'(?<![-\w])((?:min-)?width)\s*:\s*(\d+)px', css, re.I):
        if int(number) >= 400:
            return prop + ': ' + number + 'px'
    return None


# The project design spec (positioning.theme): brand colours, font style, corner radius, density and elevation.
# Everything else (type scale, spacing, status colours, components) stays the shared spec in assets/ui.css.
SURFACE_COLOURS = ('page', 'surface', 'ink', 'muted', 'border')
FONTS = {
    'sans': 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif',
    'serif': '"Noto Serif SC", "Songti SC", "STSong", Georgia, serif',
    'rounded': 'ui-rounded, "SF Pro Rounded", "PingFang SC", "Microsoft YaHei", sans-serif',
    'mono': 'ui-monospace, "SF Mono", Menlo, "PingFang SC", monospace',
}
RADII = {'sharp': ('4px', '6px'), 'default': ('8px', '10px'), 'round': ('12px', '18px')}
DENSITY = {'compact': ('36px', '16px'), 'default': ('44px', '24px'), 'comfortable': ('48px', '28px')}
ELEVATION = {'flat': 'none', 'soft': '0 1px 2px rgb(15 23 42 / .06), 0 6px 16px rgb(15 23 42 / .06)'}
THEME_FIELDS = {'source', 'style', 'keywords', 'accent', 'nav', 'font', 'radius', 'density', 'elevation', *SURFACE_COLOURS}


def check_theme(theme, archetype):
    require(isinstance(theme, dict) and set(theme) <= THEME_FIELDS, 'positioning.theme fields: ' + ', '.join(sorted(THEME_FIELDS)))
    for key in ('accent', *SURFACE_COLOURS):
        require(theme.get(key) is None or (isinstance(theme[key], str) and HEX.match(theme[key])), f'positioning.theme.{key} must be #RRGGBB')
    require(theme.get('nav') in (None, 'light', 'dark'), 'positioning.theme.nav must be light or dark')
    for key, allowed in (('font', FONTS), ('radius', RADII), ('density', DENSITY), ('elevation', ELEVATION)):
        require(theme.get(key) in (None, *allowed), f'positioning.theme.{key} must be one of ' + ', '.join(allowed))
    for key in ('source', 'style', 'keywords'):
        require(theme.get(key) is None or (isinstance(theme[key], str) and len(theme[key]) <= 200), f'positioning.theme.{key} must be short text')
    # The prototype has a light mode only, and text must stay readable on its own background.
    for key in ('page', 'surface'):
        if theme.get(key):
            require(_contrast(_rgb(theme[key]), (0, 0, 0)) >= 12, f'positioning.theme.{key} must be a light background')
    if theme.get('ink'):
        require(_contrast(_rgb(theme['ink']), _rgb(theme.get('surface') or '#ffffff')) >= 7, 'positioning.theme.ink needs 7:1 contrast on the surface')
    if theme.get('muted'):
        require(_contrast(_rgb(theme['muted']), _rgb(theme.get('page') or '#f3f5f8')) >= 4.5, 'positioning.theme.muted needs 4.5:1 contrast on the page')
    require(not (archetype == 'mobile_app' and theme.get('density') == 'compact'), 'mobile_app keeps 44px touch targets; density cannot be compact')


def theme_tokens(positioning):
    """Token overrides for one project's prototype, from its design spec, plus a summary for the report.

    An accent too light for white button text carries dark text, or is darkened when neither reaches 4.5:1."""
    theme = positioning.get('theme') or {}
    archetype = positioning.get('archetype', 'workspace')
    nav = theme.get('nav') or ('dark' if archetype in DARK_NAV else 'light')
    tokens, notes = {}, []
    white, black = (255, 255, 255), (0, 0, 0)
    for key in SURFACE_COLOURS:
        if theme.get(key):
            tokens[key] = theme[key]
    if theme.get('page'):
        page = _rgb(theme['page'])
        tokens.update({'surface-subtle': _hex(_mix(page, white, 0.5)), 'surface-muted': _hex(_mix(page, black, 0.04))})
    if theme.get('border'):
        tokens['border-strong'] = _hex(_mix(_rgb(theme['border']), black, 0.18))
    if theme.get('accent'):
        accent = _rgb(theme['accent'])
        dark_text = _rgb(theme.get('ink') or '#202d40')
        steps = 0
        if _contrast(accent, white) < 4.5 and max(_contrast(accent, dark_text), _contrast(accent, black)) >= 4.5:
            # Bright brand colours (orange, yellow, light green) keep their hue and carry dark text instead.
            tokens['on-accent'] = 'var(--ui-ink)' if _contrast(accent, dark_text) >= 4.5 else '#000000'
            notes.append(f"accent {theme['accent']} carries dark text for 4.5:1 contrast")
        while _contrast(accent, white) < 4.5 and 'on-accent' not in tokens and steps < 40:
            accent = _mix(accent, black, 0.05); steps += 1
        if steps:
            notes.append(f"accent darkened from {theme['accent']} to {_hex(accent)} for 4.5:1 text contrast")
        ink = accent
        while _contrast(ink, _rgb(theme.get('page') or '#f3f5f8')) < 4.5 and steps < 80:
            ink = _mix(ink, black, 0.05); steps += 1
        tokens.update({'accent': _hex(accent), 'accent-ink': _hex(_mix(ink, black, 0.1)), 'accent-soft': _hex(_mix(accent, white, 0.92)),
                       'accent-soft-strong': _hex(_mix(accent, white, 0.84)), 'accent-border': _hex(_mix(accent, white, 0.6))})
    if nav == 'light':
        tokens.update({'nav': 'var(--ui-surface)', 'nav-ink': 'var(--ui-ink)', 'nav-muted': 'var(--ui-muted)', 'nav-hover': 'var(--ui-surface-muted)',
                       'nav-active': 'var(--ui-accent-soft)', 'nav-line': 'var(--ui-border)'})
    elif theme.get('accent'):
        # A dark navigation tinted with the brand colour, so it belongs to the same palette.
        base = _mix(_rgb(tokens['accent']), (14, 20, 32), 0.82)
        tokens.update({'nav': _hex(base), 'nav-hover': _hex(_mix(base, white, 0.08)), 'nav-active': _hex(_mix(base, white, 0.14)),
                       'nav-line': _hex(_mix(base, white, 0.22))})
    font, radius, density, elevation = (theme.get('font') or 'sans', theme.get('radius') or 'default',
                                        theme.get('density') or 'default', theme.get('elevation') or 'flat')
    # The font style sets headings (as the design system pairs a display face with a plain body); rounded and
    # mono products carry it into body text too.
    if font != 'sans':
        tokens['font-heading'] = FONTS[font]
        if font in ('rounded', 'mono'):
            tokens['font'] = FONTS[font]
    if radius != 'default':
        tokens['radius-sm'], tokens['radius'] = RADII[radius]
    if density != 'default':
        tokens['control-height'], tokens['card-padding'] = DENSITY[density]
    if elevation != 'flat':
        tokens['card-shadow'] = ELEVATION[elevation]
    css = ':root{' + ''.join(f'--ui-{key}:{value};' for key, value in tokens.items()) + '}' if tokens else ''
    summary = {'source': theme.get('source') or ('brand' if theme.get('accent') else 'default'), 'style': theme.get('style', ''),
               'nav': nav, 'accent': tokens.get('accent', '#2863d6'), 'font': font, 'radius': radius, 'density': density,
               'elevation': elevation, 'colors': {key: theme[key] for key in SURFACE_COLOURS if theme.get(key)}, 'notes': notes}
    return css, summary


def _chroma(value):
    r, g, b = (part / 255 for part in _rgb(value))
    high, low = max(r, g, b), min(r, g, b)
    return high - low


def theme_from_design_system(design_system, archetype='workspace'):
    """Turn a UI/UX Pro Max --design-system --json result into positioning.theme.

    Its "accent" is the call-to-action colour; our accent is the interactive colour, so a near-black primary
    hands over to its accent. Dark palettes, web fonts, glass/clay effects and landing-page patterns are not
    carried over: the prototype is a light, single-file page built from the shared components."""
    system = design_system.get('design_system', design_system)
    colours = {key.lower().replace(' ', '_'): value for key, value in (system.get('colors') or {}).items() if isinstance(value, str)}
    style = system.get('style') or {}
    typography = system.get('typography') or {}
    words = ' '.join(str(value) for value in (style.get('name'), style.get('keywords'), style.get('effects'), typography.get('mood'),
                                              typography.get('heading'), typography.get('body'))).lower()
    theme = {'source': 'ui-ux-pro-max', 'style': str(style.get('name') or '')[:200]}
    if style.get('keywords'):
        theme['keywords'] = str(style['keywords'])[:200]
    primary = colours.get('primary')
    pick = primary if primary and HEX.match(primary) and _chroma(primary) >= 0.25 else colours.get('accent')
    if pick and HEX.match(pick):
        theme['accent'] = pick.lower()
    background, foreground = colours.get('background'), colours.get('foreground') or colours.get('text')
    if background and HEX.match(background) and _contrast(_rgb(background), (0, 0, 0)) >= 12:
        theme['page'] = background.lower()
        for ours, theirs in (('surface', 'card'), ('ink', None), ('muted', 'muted_foreground'), ('border', 'border')):
            value = foreground if ours == 'ink' else colours.get(theirs)
            if value and HEX.match(value):
                theme[ours] = value.lower()
    # Drop colours that would fail our contrast rules rather than fail generation.
    try:
        check_theme(theme, archetype)
    except ValueError:
        for key in ('muted', 'ink', 'surface', 'page', 'border'):
            theme.pop(key, None)
    heading = str(typography.get('heading') or '').lower()
    has = lambda *terms: any(re.search(r'(?<![a-z-])' + re.escape(term) + r'(?![a-z-])', words) for term in terms)
    if any(name in heading for name in ('serif', 'garamond', 'playfair', 'lora', 'merriweather', 'cormorant', 'libre baskerville', 'noto serif')) and 'sans' not in heading:
        theme['font'] = 'serif'
    elif any(name in heading for name in ('mono', 'code')):
        theme['font'] = 'mono'
    elif any(name in heading for name in ('baloo', 'nunito', 'fredoka', 'quicksand', 'varela round', 'comfortaa')):
        theme['font'] = 'rounded'
    if has('brutalism', 'brutalist', 'swiss', 'sharp', 'editorial'):
        theme['radius'] = 'sharp'
    elif has('claymorphism', 'clay', 'bubbly', 'rounded', 'playful', 'toy-like'):
        theme['radius'] = 'round'
    if has('glassmorphism', 'claymorphism', 'neumorphism', 'soft 3d', 'depth', 'double shadows'):
        theme['elevation'] = 'soft'
    if archetype == 'dashboard' or has('data-dense', 'dense'):
        theme['density'] = 'compact'
    elif archetype not in ('workspace', 'dashboard') and has('spacious', 'large sections', 'airy'):
        theme['density'] = 'comfortable'
    theme['nav'] = 'dark' if archetype in DARK_NAV else 'light'
    check_theme(theme, archetype)
    return theme


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
    check_theme(positioning.get('theme', {}), archetype)
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
        require(not rigid_layout(css), key + ' css fixes ' + str(rigid_layout(css)) + ' without an @media rule for narrow screens; use ui-grid or add @media (max-width: 599px)')
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
        'theme': theme_tokens(positioning)[1],
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
    payload['theme'] = theme_tokens(design['positioning'])[1]
    if design.get('feedback_form_url'):
        payload['feedback'] = {'url': design['feedback_form_url'], 'project_id': project['project_id']}
    data = json.dumps(payload, ensure_ascii=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
    template = (PACKAGE / 'assets/prototype-shell.html').read_text(encoding='utf-8')
    theme_css, _ = theme_tokens(design['positioning'])
    return template.replace('__PROTOTYPE_STYLE__', (PACKAGE / 'assets/ui.css').read_text(encoding='utf-8') + '\n' + theme_css).replace('__PROTOTYPE_DATA__', data)


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
    parser.add_argument('project', type=Path, help='project.json, or a UI/UX Pro Max design system JSON with --theme-from')
    parser.add_argument('--theme-from', action='store_true', help='print positioning.theme converted from a UI/UX Pro Max --design-system --json file')
    parser.add_argument('--archetype', default='workspace', choices=sorted(ARCHETYPES))
    args = parser.parse_args()
    if args.theme_from:
        try:
            print(json.dumps(theme_from_design_system(json.loads(args.project.read_text(encoding='utf-8-sig')), args.archetype), ensure_ascii=False, indent=2))
        except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
            print('Design system conversion failed: ' + str(error), file=sys.stderr)
            raise SystemExit(1)
        return
    try:
        _, report = check_design(json.loads(args.project.read_text(encoding='utf-8-sig')))
    except (OSError, ValueError, KeyError, TypeError) as error:
        print('Prototype design check failed: ' + str(error), file=sys.stderr)
        raise SystemExit(1)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
