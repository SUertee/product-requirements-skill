#!/usr/bin/env python3
"""Apply version-bound review notes and compare immutable requirement baselines."""
import copy
import hashlib
import json


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def reconcile(baseline, candidate):
    """Retain stable identities and locked values, and expose conflicting proposals."""
    result = copy.deepcopy(candidate)
    old = {item['requirement_id']: item for item in baseline['requirements']}
    new = {item['requirement_id']: item for item in result['requirements']}
    missing = set(old) - set(new)
    if missing:
        raise ValueError('Keep previous requirements and mark explicit cancellations: ' + ', '.join(sorted(missing)))
    conflicts = []
    for key, previous in old.items():
        current = new[key]
        for field in previous.get('locked_fields', []):
            if current.get(field) != previous[field]:
                conflicts.append({'target': key, 'field': field, 'retained': previous[field], 'proposed': current.get(field), 'reason': 'human_locked'})
                current[field] = copy.deepcopy(previous[field])
        current['locked_fields'] = sorted(set(previous.get('locked_fields', [])) | set(current.get('locked_fields', [])))
        changed = any(current.get(field) != previous.get(field) for field in set(current) | set(previous) if field not in {'review_status', 'locked_fields'})
        if changed and current.get('lifecycle_status') != 'cancelled':
            current['review_status'] = 'draft'
        if current.get('lifecycle_status') == 'cancelled':
            current['review_status'] = 'parked'
        # Analysis cannot promote an existing requirement without a human decision.
        if previous['review_status'] != 'confirmed' and current['review_status'] == 'confirmed':
            current['review_status'] = previous['review_status']
    for key in set(new) - set(old):
        if new[key]['review_status'] == 'confirmed':
            new[key]['review_status'] = 'draft'
    return result, conflicts


def differences(baseline, candidate, conflicts=None):
    changes = []
    old = {item['requirement_id']: item for item in baseline['requirements']}
    new = {item['requirement_id']: item for item in candidate['requirements']}
    for key, current in new.items():
        previous = old.get(key)
        if previous is None:
            changes.append({'target': key, 'kind': 'added', 'old': None, 'new': current})
            continue
        for field in sorted(set(previous) | set(current)):
            if previous.get(field) != current.get(field):
                changes.append({'target': key, 'field': field, 'kind': 'modified', 'old': previous.get(field), 'new': current.get(field)})
    for field in ['requirement_profile', 'context_sources', 'business_model', 'pages', 'modules', 'module_relations', 'apis']:
        if baseline.get(field) != candidate.get(field):
            changes.append({'target': field, 'kind': 'modified', 'old': baseline.get(field), 'new': candidate.get(field)})
    return {'project_id': candidate['project_id'], 'baseline_version': baseline['artifact_version'],
            'artifact_version': candidate['artifact_version'], 'changes': changes, 'conflicts': conflicts or []}


def apply_review(baseline, notes, version, changes=None):
    if notes.get('project_id') != baseline['project_id'] or notes.get('artifact_version') != baseline['artifact_version']:
        raise ValueError('Review notes belong to a different project or artifact version.')
    if notes.get('review_stage', 'definition') != 'definition':
        raise ValueError('This operation applies definition review notes.')
    if not isinstance(version, str) or not version.strip() or version == baseline['artifact_version']:
        raise ValueError('Choose a new artifact version.')
    result = copy.deepcopy(baseline)
    result.update(artifact_version=version, baseline_version=baseline['artifact_version'])
    requirements = {item['requirement_id']: item for item in result['requirements']}
    modified = set()
    fields = {'title', 'role', 'trigger', 'behavior', 'inputs', 'outputs', 'rules', 'exceptions', 'acceptance_criteria', 'lifecycle_status', 'source_refs', 'evidence_type', 'locked_fields'}
    lock_changes = {}
    for change in changes or []:
        target, field = change.get('target'), change.get('field')
        if target not in requirements or field not in fields or 'value' not in change:
            raise ValueError('Invalid requirement field change.')
        if field == 'locked_fields':
            value = change['value']
            if not isinstance(value, list) or not all(isinstance(key, str) and key in requirements[target] and key != 'locked_fields' for key in value):
                raise ValueError('Lock changes must name existing requirement fields.')
            lock_changes[target] = sorted(set(value))
        requirements[target][field] = copy.deepcopy(change['value'])
        if field != 'locked_fields':
            modified.add(target)
    comparison = copy.deepcopy(baseline)
    for previous in comparison['requirements']:
        key = previous['requirement_id']
        if key in lock_changes:
            previous['locked_fields'] = [field for field in previous.get('locked_fields', []) if field in lock_changes[key]]
    result, conflicts = reconcile(comparison, result)
    requirements = {item['requirement_id']: item for item in result['requirements']}
    seen = set()
    decisions = notes.get('decisions')
    if not isinstance(decisions, list):
        raise ValueError('Review decisions must be an array.')
    for decision in decisions:
        key = decision.get('decision_id')
        if not isinstance(key, str) or not key or key in seen:
            raise ValueError('Review decision IDs must be unique.')
        seen.add(key)
        if decision.get('artifact_version', baseline['artifact_version']) != baseline['artifact_version'] or decision.get('review_stage', 'definition') != 'definition':
            raise ValueError('Decision version or review stage does not match the baseline.')
        target = decision.get('target')
        outcome = decision.get('outcome')
        if outcome not in {'confirmed', 'needs_changes', 'parked'}:
            raise ValueError('Invalid review outcome.')
        if target in requirements:
            requirement = requirements[target]
            status = {'confirmed': 'confirmed', 'needs_changes': 'draft', 'parked': 'parked'}[outcome]
            if target in modified or any(item['target'] == target for item in conflicts):
                status = 'draft'
            if requirement.get('lifecycle_status') == 'cancelled':
                status = 'parked'
            requirement['review_status'] = status
    result['review_lineage'] = {'source_version': baseline['artifact_version'], 'notes_sha256': digest(notes), 'decision_ids': sorted(seen)}
    diff = differences(baseline, result, conflicts)
    return result, diff
