(() => {
  'use strict';
  const data = JSON.parse(document.getElementById('workbench-data').textContent);
  const project = data.project;
  const requirements = project.requirements;
  const sourceMap = new Map(data.sources.map(source => [source.source_id, source]));
  const states = {draft: '草稿', confirmed: '已确认', disputed: '冲突', parked: '暂缓'};
  const evidenceNames = {explicit: '明确表达', inferred: '模型推断', suggested: '产品建议', unknown: '待确认'};
  const views = {overview: '总览', materials: '会议素材', modules: '功能需求', documents: '方案文档', prototype: '原型预览', technical: '技术设计', review: '评审记录'};
  const content = document.getElementById('page-content');
  const queryInput = document.getElementById('search');
  const statusInput = document.getElementById('status');
  const evidenceInput = document.getElementById('evidence');
  let active = 'overview';
  let selectedSource = null;
  let selectedHighlight = null;
  let technicalTab = 'diagrams';
  let selectedArchitecture = null;
  let selectedEntity = null;
  let selectedMaterial = null;
  let selectedModule = null;
  let moduleView = 'list';
  let selectedRequirement = null;
  let moduleDetailTab = 'requirements';
  let requirementTab = 'detail';
  let moduleFrame = null;
  let selectDiagramModule = null;
  const requestedDocument = new URLSearchParams(location.search).get('document');
  let selectedDocument = ['proposal.md', 'prd.md'].includes(requestedDocument) ? requestedDocument : 'proposal.md';
  let handoffOpen = requestedDocument === 'agent-prompt.md';
  let handoffMessage = '';
  let intakeSource = 'file';
  let requirementMore = false;
  let requirementQuotesAll = false;
  const documentDrafts = {};
  let documentEditing = false;
  let documentSaving = false;
  let documentMessage = '';
  let documentChapter = 0;
  let documentEntry = 0;
  let materialTab = 'library';
  let materialReader = 'highlights';
  let materialQuery = '';
  let materialPage = 0;
  let showFilters = false;
  let serverState = null;
  let intakeBusy = false;
  let intakeMessage = '';
  let reviewMessage = '';
  let reviewTarget = null;
  let reviewTab = 'records';
  let workflowBusy = false;
  let workflowMessage = '';
  let appliedTask = null;  // version created from the review bar this session
  let pendingChanges = [];
  let previewDevice = 'desktop';

  function element(tag, text, className) {
    const result = document.createElement(tag);
    if (text !== undefined && text !== null) result.textContent = String(text);
    if (className) result.className = className;
    return result;
  }
  function sectionTabs(items, selected, label, onSelect) {
    const navigation = element('div', null, 'section-tabs');
    navigation.setAttribute('role', 'group');
    navigation.setAttribute('aria-label', label);
    for (const [key, title, marker] of items) {
      const button = element('button', title);
      if (marker) iconLabel(button, marker);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(key === selected));
      button.addEventListener('click', () => {
        onSelect(key);
        const current = Array.from(document.querySelectorAll('.section-tabs')).find(node => node.getAttribute('aria-label') === label);
        Array.from(current?.querySelectorAll('button') || []).find(node => node.textContent === title)?.focus();
      });
      navigation.append(button);
    }
    return navigation;
  }
  function display(value) {
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length) || (typeof value === 'object' && !Object.keys(value).length)) return '待确认';
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  }
  function empty(text) { return element('div', text, 'workbench-empty'); }
  function analysisFor(job) {
    return serverState?.tasks?.filter(task => (task.job_ids || []).includes(job.job_id)).at(-1);
  }
  function hasTranscript(job) {
    return serverState.jobs.some(item => item.provenance.related_job_id === job.job_id && item.status === 'ready_for_analysis');
  }
  function panel(title, marker) {
    const section = element('section', null, 'panel requirement-card');
    const heading = element('h2', title);
    if (marker) iconLabel(heading, marker);
    section.append(heading);
    return section;
  }
  function valueNode(value, depth = 0) {
    if (value === null || value === undefined || typeof value !== 'object' || depth > 3) return element('span', display(value));
    if (Array.isArray(value)) {
      if (!value.length) return element('span', '待确认');
      const list = element('ul', null, 'value-list');
      value.forEach(item => { const row = element('li'); row.append(valueNode(item, depth + 1)); list.append(row); });
      return list;
    }
    const pairs = Object.entries(value);
    if (!pairs.length) return element('span', '待确认');
    const list = element('dl', null, 'value-object');
    pairs.forEach(([key, item]) => { const definition = element('dd'); definition.append(valueNode(item, depth + 1)); list.append(element('dt', key), definition); });
    return list;
  }
  function locatorLabel(locator) {
    if (typeof locator.start_seconds === 'number') {
      const minutes = Math.floor(locator.start_seconds / 60);
      const seconds = Math.floor(locator.start_seconds % 60);
      return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
    }
    if (locator.entry) return '人工记录 ' + locator.entry;
    return locator.paragraph ? '段落 ' + locator.paragraph : '定位待确认';
  }
  function fields(parent, pairs) {
    const list = element('dl', null, 'workbench-values');
    for (const [label, value] of pairs) {
      const definition = element('dd');
      definition.append(valueNode(value));
      list.append(element('dt', label), definition);
    }
    parent.append(list);
  }
  function badges(parent, values) {
    const row = element('div', null, 'workbench-meta');
    values.forEach(value => row.append(element('span', value)));
    parent.append(row);
  }
  function matches(value) {
    return JSON.stringify(value).toLowerCase().includes(queryInput.value.trim().toLowerCase());
  }
  function filteredRequirements() {
    return requirements.filter(req => {
      const context = {
        requirement: req,
        modules: (project.modules || []).filter(module => (module.requirement_ids || []).includes(req.requirement_id)).map(module => [module.module_id, module.name]),
        sources: req.source_refs.map(id => sourceMap.get(id)?.text)
      };
      return matches(context) && (!statusInput.value || req.review_status === statusInput.value) && (!evidenceInput.value || req.evidence_type === evidenceInput.value);
    });
  }
  function fileLink(path, label) {
    const link = element('a', label, 'button ghost small');
    link.href = '../' + path.split('/').map(encodeURIComponent).join('/');
    link.target = '_blank';
    link.rel = 'noopener';
    return iconLabel(link, label.startsWith('下载') ? 'download' : 'external');
  }
  function selectionLayout(items, selectedKey, label, onSelect) {
    const layout = element('div', null, 'selection-layout');
    const list = element('nav', null, 'selection-list');
    list.setAttribute('aria-label', label);
    const detail = element('div', null, 'selection-detail');
    items.forEach(item => {
      const button = element('button', null, 'selection-button');
      button.type = 'button';
      button.dataset.selectionKey = item.key;
      const title = element('strong', item.title);
      if (item.marker) iconLabel(title, item.marker);
      button.append(title);
      if (item.meta) button.append(element('span', item.meta, 'selection-meta'));
      if (item.key === selectedKey) button.setAttribute('aria-current', 'true');
      button.addEventListener('click', () => {
        onSelect(item.key);
        render();
        Array.from(content.querySelectorAll('[data-selection-key]'))
          .find(node => node.dataset.selectionKey === item.key)?.focus();
      });
      list.append(button);
    });
    layout.append(list, detail);
    content.append(layout);
    return detail;
  }
  function openRequirement(req) {
    selectedRequirement = req.requirement_id;
    moduleView = 'list';
    requirementTab = 'detail';
    moduleDetailTab = 'requirements';
    selectedModule = null;
    queryInput.value = ''; statusInput.value = ''; evidenceInput.value = '';
    navigate('modules');
  }
  function requirementLink(req) {
    const button = element('button', req.title, 'source-link');
    button.dataset.requirementId = req.requirement_id;
    button.title = '需求编号 ' + req.requirement_id;
    button.type = 'button';
    button.addEventListener('click', () => openRequirement(req));
    return button;
  }
  function openSource(sourceId, highlightIndex = null) {
    selectedSource = sourceId;
    selectedHighlight = highlightIndex;
    queryInput.value = '';
    materialTab = 'library';
    materialReader = 'highlights';
    materialQuery = '';
    navigate('materials');
    focusSource();
  }
  function focusSource() {
    const target = document.getElementById('meeting-evidence-title') || content.querySelector('.source-selected');
    target?.focus({preventScroll: true});
    const compact = window.innerWidth <= 800;
    const readingArea = compact ? target?.closest('.meeting-evidence') || target : target;
    readingArea?.scrollIntoView?.({block: compact ? 'start' : 'nearest'});
  }
  function sourceLink(sourceId, highlightIndex = null) {
    const source = sourceMap.get(sourceId);
    const button = element('button', '查看原话 · ' + locatorLabel(source?.locator || {}), 'source-link');
    button.type = 'button';
    button.dataset.sourceRef = sourceId;
    button.addEventListener('click', () => openSource(sourceId, highlightIndex));
    return button;
  }
  function requirementEditor(req) {
    const detail = element('section');
    const form = element('form', null, 'intake-form');
    const select = element('select'); select.id = 'edit-field-' + req.requirement_id;
    const labels = {behavior: '功能内容', acceptance_criteria: '验收标准', rules: '业务规则', exceptions: '出错时怎么处理', role: '使用者', title: '需求名称'};
    for (const [key, label] of Object.entries(labels)) { const option = element('option', label); option.value = key; select.append(option); }
    const fieldLabel = element('label', '改哪一项'); fieldLabel.htmlFor = select.id;
    const text = element('textarea'); text.id = 'edit-value-' + req.requirement_id; text.rows = 4;
    const textLabel = element('label', '改成'); textLabel.htmlFor = text.id;
    const lockLabel = element('label', null, 'workflow-check'); const lock = element('input'); lock.type = 'checkbox'; lockLabel.append(lock, element('span', '锁定：以后分析新会议时不改这一项（锁定时需先取消勾选才能编辑）'));
    const message = element('p', '', 'inline-note'); message.setAttribute('role', 'status');
    function loadField() {
      const pending = pendingChanges.find(item => item.target === req.requirement_id && item.field === select.value);
      const value = pending ? pending.value : req[select.value];
      text.value = value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      const locks = pendingChanges.find(item => item.target === req.requirement_id && item.field === 'locked_fields')?.value || req.locked_fields || [];
      lock.checked = locks.includes(select.value); text.readOnly = lock.checked;
    }
    select.addEventListener('change', loadField); lock.addEventListener('change', () => { text.readOnly = lock.checked; }); loadField();
    const submit = iconLabel(element('button', '保存修改', 'button primary'), 'edit'); submit.type = 'submit';
    form.append(fieldLabel, select, textLabel, text, lockLabel, submit, message);
    form.addEventListener('submit', event => {
      event.preventDefault();
      try {
        const raw = text.value.trim();
        let value = raw.startsWith('[') || raw.startsWith('{') ? JSON.parse(raw) : raw || null;
        const key = select.value;
        pendingChanges = pendingChanges.filter(item => !(item.target === req.requirement_id && item.field === key));
        if (JSON.stringify(req[key] ?? null) !== JSON.stringify(value)) pendingChanges.push({target: req.requirement_id, field: key, value});
        const original = req.locked_fields || [];
        const current = new Set(pendingChanges.find(item => item.target === req.requirement_id && item.field === 'locked_fields')?.value || original);
        if (lock.checked) current.add(key); else current.delete(key);
        pendingChanges = pendingChanges.filter(item => !(item.target === req.requirement_id && item.field === 'locked_fields'));
        if (JSON.stringify([...current].sort()) !== JSON.stringify([...original].sort())) pendingChanges.push({target: req.requirement_id, field: 'locked_fields', value: [...current].sort()});
        message.textContent = '已暂存。页面顶部“生成新版本”后生效';
      } catch (error) { message.textContent = error.message; }
    });
    detail.append(form); return detail;
  }
  function appendCustomerFeedback(parent, requirementId) {
    const answers = (serverState?.customer_feedback || []).filter(item => item.target === requirementId);
    if (!answers.length) return;
    const section = element('section', null, 'requirement-feedback');
    section.append(element('h3', '客户反馈'));
    for (const item of answers) {
      const row = element('div', null, 'source-quote customer-answer');
      if (item.prompt) {
        row.append(element('strong', item.prompt), element('p', item.answer));
        if (item.note) row.append(element('p', item.note));
        const meta = [item.source === 'prototype_feedback' ? '原型意见 · ' + (item.artifact_version || '') : '', item.respondent].filter(Boolean).join(' · ');
        if (meta) row.append(element('p', meta, 'workbench-meta'));
      }
      row.append(jobLink(item, 'original', '查看原始答复'));
      section.append(row);
    }
    parent.append(section);
  }
  // A verdict saved on this version but not yet applied: shown right away as "（待生效）" until 生成新版本 applies it.
  function pendingVerdict(target) {
    const decided = (serverState?.review?.decisions || []).filter(item => item.target === target && (item.review_stage || 'definition') === 'definition').at(-1);
    return decided || null;
  }
  function statusView(item) {
    const target = item.requirement_id || item.nfr_id;
    const pending = pendingVerdict(target);
    if (!pending) return {status: item.review_status, label: states[item.review_status] || '草稿', pending: false};
    const status = {confirmed: 'confirmed', needs_changes: 'draft', parked: 'parked'}[pending.outcome];
    return {status, label: {confirmed: '确认', needs_changes: '需修改', parked: '暂缓'}[pending.outcome] + '（待生效）', pending: true};
  }
  function requirementChoice(req, current, onSelect) {
    const button = element('button', null, 'requirement-choice'); button.type = 'button';
    button.dataset.requirementId = req.requirement_id || req.nfr_id;
    button.title = '编号 ' + (req.requirement_id || req.nfr_id);
    button.setAttribute('aria-pressed', String(req === current));
    const view = statusView(req);
    // The narrow list keeps the short verdict; the dashed border and tooltip mark it as not yet applied.
    const status = element('span', view.pending ? view.label.replace('（待生效）', '') : view.label, 'requirement-choice-status');
    status.dataset.status = view.status; if (view.pending) { status.dataset.pending = 'true'; status.title = view.label + '：生成新版本后生效'; }
    button.append(element('strong', req.title), status);
    button.addEventListener('click', onSelect);
    return button;
  }
  // Review happens on the item itself (functional or non-functional): a verdict with an optional note.
  // The 评审记录 page only keeps the log of these decisions.
  function reviewActions(target, extra) {
    const actions = element('div', null, 'requirement-actions');
    if (!serverState) return actions;
    const decided = (serverState.review.decisions || []).filter(item => item.target === target && (item.review_stage || 'definition') === 'definition').at(-1);
    const labels = {confirmed: '确认', needs_changes: '需要修改', parked: '暂缓'};
    if (decided) actions.append(element('p', '已记录：' + labels[decided.outcome] + (decided.comment ? ' · ' + decided.comment : ''), 'inline-note decision-note'));
    const note = element('input'); note.id = 'review-comment'; note.placeholder = '意见（选填）'; note.maxLength = 10000; note.setAttribute('aria-label', '意见（选填）');
    const verdicts = element('div', null, 'outcome-choices'); verdicts.setAttribute('role', 'group'); verdicts.setAttribute('aria-label', '评审结论');
    for (const [value, label] of Object.entries(labels)) {
      const button = element('button', label, 'button small'); button.type = 'button'; button.dataset.outcome = value;
      button.setAttribute('aria-pressed', String(decided?.outcome === value));
      button.addEventListener('click', async () => {
        try {
          const result = await localRequest('/api/review', {method: 'POST', body: JSON.stringify({revision: serverState.review.revision, review_stage: 'definition', target, outcome: value, comment: note.value, reviewer: ''})});
          serverState.review = result.review; reviewMessage = '';
        } catch (error) { reviewMessage = error.message; }
        render();
      });
      verdicts.append(button);
    }
    actions.append(note, verdicts);
    if (extra) actions.append(extra);
    if (reviewMessage) actions.append(element('p', reviewMessage, 'inline-note'));
    return actions;
  }
  // A non-functional requirement (performance, permissions, devices…) reviewed the same way as a functional one.
  function nfrCard(nfr) {
    const card = panel(nfr.title);
    card.classList.add('requirement-inspector');
    const identity = element('div', null, 'requirement-identity');
    const evidence = element('span', '来源：' + (evidenceNames[nfr.evidence_type] || '待确认'), 'evidence-tag'); evidence.dataset.evidence = nfr.evidence_type || 'unknown';
    const view = statusView(nfr);
    const status = element('span', '状态：' + view.label, 'status-tag'); status.dataset.status = view.status; if (view.pending) status.dataset.pending = 'true';
    identity.append(evidence, status, element('span', nfr.nfr_id, 'requirement-code'));
    const head = element('header', null, 'requirement-head'); head.append(card.firstElementChild, identity);
    card.append(head);
    const body = element('div', null, 'requirement-tab-body');
    const section = (label, marker, value) => { const entry = element('section', null, 'requirement-section'); entry.append(iconLabel(element('h3', label), marker), valueNode(value)); body.append(entry); };
    section('类别', 'modules', nfrCategories[nfr.category] || nfr.category);
    section('要求', 'documents', nfr.statement);
    const treatment = nfr.prototype_treatment;
    section('原型中怎么体现', 'prototype', treatment ? (treatment.kind === 'shown' ? '体现：' : '原型不体现：') + (treatment.note || '') : '待确认');
    const related = requirements.filter(req => nfr.requirement_ids?.includes(req.requirement_id));
    if (related.length) { const links = element('p', '关联需求：', 'inline-note entity-reqs'); related.forEach(req => links.append(requirementLink(req))); body.append(links); }
    const refs = nfr.source_refs || [];
    if (refs.length) {
      const sources = element('section', null, 'requirement-section requirement-sources'); sources.append(iconLabel(element('h3', '会议原话（' + refs.length + '）'), 'quote'));
      for (const sourceId of refs.slice(0, 2)) { const citation = element('div', null, 'requirement-citation'); citation.append(sourceLink(sourceId), element('blockquote', sourceMap.get(sourceId)?.text || '来源待补充', 'source-quote')); sources.append(citation); }
      body.append(sources);
    }
    card.append(body, reviewActions(nfr.nfr_id));
    return card;
  }
  function requirementCard(req) {
    const card = panel(req.title);
    card.classList.add('requirement-inspector');
    const identity = element('div', null, 'requirement-identity');
    // Two facts about a requirement, each with its label: where it came from, and whether a person has confirmed it.
    const evidenceHelp = {explicit: '客户在会上直接说过', inferred: 'AI 根据会议推断，需人核对', suggested: '产品建议，客户没提过', unknown: '依据待补充'};
    const statusHelp = {draft: '还没人确认', confirmed: '负责人已确认', disputed: '前后说法冲突，待裁决', parked: '本期不做'};
    const evidence = element('span', '来源：' + (evidenceNames[req.evidence_type] || '待确认'), 'evidence-tag');
    evidence.title = evidenceHelp[req.evidence_type] || evidenceHelp.unknown;
    evidence.dataset.evidence = req.evidence_type || 'unknown';
    const view = statusView(req);
    const status = element('span', '状态：' + view.label, 'status-tag');
    status.title = view.pending ? '评审结论已保存，生成新版本后生效' : statusHelp[req.review_status] || statusHelp.draft;
    status.dataset.status = view.status; if (view.pending) status.dataset.pending = 'true';
    identity.append(evidence, status, element('span', req.requirement_id, 'requirement-code'));
    const head = element('header', null, 'requirement-head'); head.append(card.firstElementChild, identity);
    card.append(head);
    const body = element('div', null, 'requirement-tab-body');
    const editing = requirementTab === 'edit' && serverState;
    if (editing) body.append(requirementEditor(req));
    else {
      const section = (label, marker, style) => {
        const entry = element('section', null, 'requirement-section ' + style);
        entry.append(iconLabel(element('h3', label), marker));
        return entry;
      };
      const behavior = section('功能内容', 'documents', 'requirement-behavior');
      behavior.append(valueNode(req.behavior)); body.append(behavior);
      const acceptance = section('验收标准', 'decided', 'requirement-acceptance');
      acceptance.append(valueNode(req.acceptance_criteria)); body.append(acceptance);
      if (req.open_questions?.length) {
        const questions = section('需要确认', 'pending', 'requirement-questions');
        questions.append(valueNode(req.open_questions)); body.append(questions);
      }
      const known = [['使用者', req.role], ['什么时候用', req.trigger], ['输入', req.inputs], ['输出', req.outputs], ['业务规则', req.rules], ['出错时', req.exceptions]].filter(([, value]) => display(value) !== '待确认');
      if (known.length) {
        const facts = section('细节', 'modules', 'requirement-facts');
        const list = element('dl', null, 'fact-list');
        for (const [label, value] of known) list.append(element('dt', label), element('dd', display(value)));
        facts.append(list); body.append(facts);
      }
      const refs = req.source_refs || [];
      const sources = section('会议原话' + (refs.length ? '（' + refs.length + '）' : ''), 'quote', 'requirement-sources');
      if (!refs.length) sources.append(element('p', '来源待补充', 'inline-note'));
      // Two quotes are enough to judge a requirement; the rest open on demand.
      for (const sourceId of requirementQuotesAll ? refs : refs.slice(0, 2)) {
        const source = sourceMap.get(sourceId);
        const citation = element('div', null, 'requirement-citation');
        citation.append(sourceLink(sourceId), element('blockquote', source?.text || '来源待补充', 'source-quote'));
        sources.append(citation);
      }
      if (refs.length > 2) {
        const all = element('button', requirementQuotesAll ? '只看前 2 条' : '查看其余 ' + (refs.length - 2) + ' 条原话', 'button ghost small'); all.type = 'button';
        all.addEventListener('click', () => { requirementQuotesAll = !requirementQuotesAll; card.replaceWith(requirementCard(req)); });
        sources.append(all);
      }
      body.append(sources);
      appendCustomerFeedback(body, req.requirement_id);
    }
    // Review happens here, on the requirement: give a verdict (with an optional note) or edit it.
    // The 评审记录 page only keeps the log of these decisions.
    const edit = serverState ? iconLabel(element('button', editing ? '返回需求' : '修改内容', 'button small'), editing ? 'back' : 'edit') : null;
    if (edit) { edit.type = 'button'; edit.addEventListener('click', () => { requirementTab = editing ? 'detail' : 'edit'; card.replaceWith(requirementCard(req)); }); }
    const actions = reviewActions(req.requirement_id, edit);
    card.append(body, actions);
    return card;
  }
  // When verdicts or edits are waiting, one bar on the requirement page turns them into the next version.
  function pendingReviewBar() {
    if (!serverState) return null;
    const decisions = (serverState.review.decisions || []).filter(item => (item.review_stage || 'definition') === 'definition');
    if (!decisions.length && !pendingChanges.length) return null;
    const bar = element('div', null, 'review-pending-bar');
    if (appliedTask) {
      bar.append(element('span', '已生成新版本 ' + appliedTask.version + '，评审结论和修改都在新版本里'));
      const open = element('a', '打开 ' + appliedTask.version, 'button primary small'); open.href = '/versions/' + encodeURIComponent(appliedTask.id) + '/workbench/index.html#modules';
      bar.append(open); return bar;
    }
    bar.append(element('span', '已保存 ' + decisions.length + ' 条评审结论' + (pendingChanges.length ? '、' + pendingChanges.length + ' 处修改' : '') + '。当前版本保持不变，生成新版本后需求状态才更新'));
    const form = element('form', null, 'review-pending-form');
    const version = element('input'); version.id = 'review-version'; version.value = nextVersion(); version.required = true; version.setAttribute('aria-label', '新版本号');
    const submit = iconLabel(element('button', '生成新版本', 'button primary small'), 'history'); submit.type = 'submit'; submit.disabled = workflowBusy;
    form.append(version, submit);
    form.addEventListener('submit', event => {
      event.preventDefault(); const targetVersion = version.value; const changes = pendingChanges.slice(); const revision = serverState.review.revision;
      workflowAction(async () => {
        const result = await localRequest('/api/review/apply', {method: 'POST', body: JSON.stringify({version: targetVersion, revision, changes})});
        pendingChanges = []; if (result.task?.status === 'completed') appliedTask = result.task; return result;
      });
    });
    bar.append(form);
    if (workflowMessage) bar.append(element('p', workflowMessage, 'inline-note'));
    return bar;
  }
  function needsDefinitionReview() {
    const activeRequirements = requirements.filter(req => req.review_status !== 'parked' && req.lifecycle_status !== 'cancelled');
    return !activeRequirements.length || activeRequirements.some(req => req.review_status !== 'confirmed' || !req.acceptance_criteria);
  }
  function handoffPreview() {
    const box = element('section', null, 'handoff-preview');
    box.setAttribute('aria-label', '开发提示词');
    const head = element('div', null, 'handoff-head');
    head.append(element('p', '只包含已确认的需求与边界，复制后粘贴给 Claude Code、Cursor 等 Coding Agent。', 'inline-note'));
    const actions = element('div', null, 'document-actions');
    const text = data.documents['agent-prompt.md'];
    const copy = iconLabel(element('button', '复制全文', 'button primary small'), 'copy'); copy.type = 'button';
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); handoffMessage = '已复制'; } catch { handoffMessage = '浏览器未允许复制，请下载'; }
      render();
    });
    const download = iconLabel(element('button', '下载', 'button small'), 'download'); download.type = 'button';
    download.addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([text], {type: 'text/markdown;charset=utf-8'}));
      const link = element('a'); link.href = url; link.download = 'agent-prompt.md'; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    actions.append(copy, download);
    head.append(actions);
    box.append(head);
    if (handoffMessage) { const status = element('p', handoffMessage, 'inline-note'); status.setAttribute('role', 'status'); box.append(status); }
    box.append(element('pre', text, 'handoff-text'));
    return box;
  }
  function overview() {
    const needsReview = needsDefinitionReview();
    const hasArtifact = prefixes => data.artifacts.some(item => prefixes.some(prefix => item.path.startsWith(prefix)) && item.path.endsWith('.html'));
    const prototypeAvailable = hasArtifact(['prototype/']);
    const definition = panel(project.name || project.project_id);
    definition.classList.add('project-definition');
    definition.append(element('p', display(project.summary || project.requirement_profile.desired_outcomes), 'project-objective'));
    const facts = element('dl', null, 'project-facts');
    for (const [label, value] of [['面向', project.requirement_profile.customer_and_roles], ['范围', project.requirement_profile.scope]]) {
      const items = (Array.isArray(value) ? value : [value]).filter(item => typeof item === 'string' && item.trim());
      const definitionNode = element('dd');
      if (items.length) items.forEach(item => definitionNode.append(element('span', item, 'fact-chip')));
      else definitionNode.append(valueNode(value));
      facts.append(element('dt', label), definitionNode);
    }
    definition.append(facts);
    content.append(definition);

    const confirmed = requirements.filter(req => req.review_status === 'confirmed').length;
    const meetings = project.meetings || [];
    const day = value => { const date = new Date(String(value || '').replace(' ', 'T')); return Number.isNaN(date.getTime()) ? '' : (date.getMonth() + 1) + ' 月 ' + date.getDate() + ' 日'; };
    const versionNumber = /(\d+)\s*$/.exec(String(project.artifact_version || ''))?.[1];
    const lastMeeting = meetings.map(item => item.date).filter(Boolean).sort().at(-1);
    const stage = !requirements.length ? '待导入会议' : needsReview ? '需求核对中' : prototypeAvailable ? '原型待评审' : '待生成原型';
    const stats = element('dl', null, 'overview-stats');
    for (const [label, value, note] of [
      ['当前版本', project.artifact_version, day(data.generated_at) ? day(data.generated_at) + '生成' : ''],
      ['已迭代', versionNumber ? versionNumber + ' 版' : '—', project.baseline_version ? '上一版 ' + project.baseline_version : ''],
      ['会议', meetings.length + ' 次', day(lastMeeting) ? '最近 ' + day(lastMeeting) : ''],
      ['当前进度', stage, requirements.length ? confirmed + ' / ' + requirements.length + ' 条需求已确认' : ''],
    ]) {
      const item = element('div', null, 'overview-stat'); const figure = element('dd', value);
      item.append(element('dt', label), figure); if (note) item.append(element('dd', note, 'stat-note'));
      stats.append(item);
    }
    content.append(stats);

    const outputs = panel('成果', 'documents');
    outputs.classList.add('overview-outputs');
    const explicit = requirements.flatMap(req => (req.open_questions || []).map(reason => ({target: req.requirement_id, reason})));
    const pending = new Set((explicit.length ? explicit : data.review.questions || []).map(item => item.reason)).size;
    const stages = [
      ['materials', '会议素材', (project.materials || []).length ? (project.materials || []).length + ' 份素材' : '', (project.materials || []).length > 0],
      ['modules', '功能需求', requirements.length ? requirements.length + ' 条 · ' + confirmed + ' 条已确认' : '', requirements.length > 0],
      ['documents', '方案文档', '方案 · PRD', Boolean(data.documents?.['proposal.md'])],
      ['prototype', '原型预览', prototypeAvailable ? '已生成' : '', prototypeAvailable],
      ['technical', '技术设计', [project.technical_architecture?.components?.length ? '架构' : '', project.business_model?.entities?.length ? '数据模型' : ''].filter(Boolean).join(' · '), Boolean(project.technical_architecture?.components?.length) || hasArtifact(['diagrams/', 'data-model/'])],
      ['review', '评审记录', pending ? pending + ' 个问题待确认' : '暂无待确认问题', true],
    ];
    // Hand-off to development: the generated agent prompt, usable once at least one requirement is confirmed.
    const handoffReady = confirmed > 0 && Boolean(data.documents?.['agent-prompt.md']);
    stages.push(['handoff', '交给开发', '复制给 Coding Agent', handoffReady]);
    for (const [view, label, summary, ready] of stages) {
      const row = element('button', null, 'output-row'); row.type = 'button'; row.dataset.ready = String(ready); row.dataset.target = view;
      const name = element('strong'); name.append(element('i', null, 'stage-dot'), element('span', label));
      row.append(name, element('span', ready ? summary : view === 'handoff' ? '确认需求后可生成' : '暂无'));
      if (view === 'handoff') {
        row.disabled = !ready; row.setAttribute('aria-expanded', String(handoffOpen && ready));
        row.addEventListener('click', () => { handoffOpen = !handoffOpen; handoffMessage = ''; render(); });
      } else row.addEventListener('click', () => { if (view === 'review') reviewTab = 'records'; navigate(view); });
      outputs.append(row);
    }
    if (handoffOpen && handoffReady) outputs.append(handoffPreview());
    const columns = element('div', null, 'overview-sections');
    columns.append(outputs);
    const followUp = panel('待确认事项', 'pending');
    // Two origins: questions the AI raised while reading the meeting (open_questions on a requirement),
    // and gaps found by the generator's checks (missing acceptance, vague wording, unconfirmed items).
    const questions = [...explicit.map(item => ({...item, origin: 'AI 读会议时提出'})), ...(data.review.questions || []).filter(item => item.reason !== '核对依据、范围与确认状态').map(item => ({...item, origin: '规则检查发现'}))];
    const unique = questions.filter((item, index) => questions.findIndex(other => item.reason === other.reason) === index);
    if (unique.length) followUp.append(element('p', '共 ' + unique.length + ' 项，显示前 3 项；点开到评审记录回答', 'inline-note'));
    for (const question of unique.slice(0, 3)) {
      const item = element('button', null, 'output-row question-item'); item.type = 'button';
      const text = element('span', null, 'question-text');
      const owner = requirements.find(req => req.requirement_id === question.target);
      text.append(element('span', question.reason), element('small', question.origin + (owner ? ' · 需求「' + owner.title + '」' : ''), 'question-origin'));
      item.append(text, element('span', '→'));
      item.addEventListener('click', () => { const req = requirements.find(entry => entry.requirement_id === question.target); if (req) openRequirement(req); else { reviewTab = 'records'; navigate('review'); } });
      followUp.append(item);
    }
    if (!unique.length) followUp.append(element('p', '暂无待确认事项', 'inline-note'));
    columns.append(followUp); content.append(columns);
  }
  async function localRequest(path, options = {}) {
    const response = await fetch(path, {...options, headers: {'X-Workbench-Request': '1', 'X-Workbench-Run': location.pathname.match(/^\/versions\/(AN-[a-f0-9]{24})\//)?.[1] || '', ...options.headers}});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '请求失败，请重试');
    return result;
  }
  async function refreshLocal() {
    const result = await localRequest('/api/status');
    if (result.service !== 'product-requirements-workbench/0.1' || result.project_id !== project.project_id || result.artifact_version !== project.artifact_version) throw new Error('本地服务对应其他项目或版本');
    serverState = result;
  }
  function jobLink(job, key, label) {
    const link = element('a', label, 'button ghost small');
    link.href = '/api/jobs/' + encodeURIComponent(job.job_id) + '/' + key;
    link.target = '_blank';
    link.rel = 'noopener';
    return link;
  }
  async function importAction(action) {
    intakeBusy = true;
    intakeMessage = '正在接收和预处理素材…';
    render();
    try {
      await action();
      intakeMessage = '素材已进入接收箱，请查看处理状态';
    } catch (error) { intakeMessage = error.message; }
    finally {
      intakeBusy = false;
      try { await refreshLocal(); } catch (error) { intakeMessage += ' · ' + error.message; }
      render();
    }
  }
  function intakePanel() {
    const card = panel('导入会议');
    if (!serverState) {
      card.append(element('p', '当前为只读分享版，导入素材请在本机工作台中进行。当前版本的资料可继续浏览。', 'inline-note'));
      if (intakeMessage) card.append(element('p', intakeMessage, 'inline-note'));
      content.append(card);
      return;
    }
    // Pick a source, then import: local files or a Feishu Minutes link, one button.
    const feishuReady = Boolean(serverState.lark_cli_available);
    if (intakeSource === 'feishu' && !feishuReady) intakeSource = 'file';
    const sources = sectionTabs([['file', '本地文件'], ['feishu', '飞书妙记']], intakeSource, '素材来源', key => { intakeSource = key; intakeMessage = ''; render(); });
    sources.classList.add('intake-sources');
    if (!feishuReady) { const option = [...sources.querySelectorAll('button')].find(item => item.textContent === '飞书妙记'); if (option) { option.disabled = true; option.title = '本机未连接飞书（lark-cli 未就绪）'; } }
    const form = element('form', null, 'intake-form');
    const submit = iconLabel(element('button', '导入', 'button primary'), 'upload'); submit.type = 'submit';
    if (intakeSource === 'file') {
      const files = element('input');
      files.id = 'material-file'; files.type = 'file'; files.multiple = true; files.className = 'sr-only';
      files.accept = '.txt,.md,.srt,.vtt,.mp3,.wav,.m4a,.aac,.ogg,.flac,.mp4,.mov,.webm,.mkv';
      files.disabled = intakeBusy;
      const drop = element('label', null, 'intake-drop'); drop.htmlFor = files.id;
      const hint = element('span', '逐字稿 TXT／MD／SRT／VTT，或录音、录屏；每个文件最大 256 MB');
      drop.append(iconLabel(element('strong', '选择文件，或拖到这里'), 'upload'), hint);
      submit.disabled = true;
      const chosen = () => {
        const names = Array.from(files.files).map(file => file.name);
        hint.textContent = names.length ? names.join('、') : '逐字稿 TXT／MD／SRT／VTT，或录音、录屏；每个文件最大 256 MB';
        drop.classList.toggle('has-files', names.length > 0);
        submit.disabled = intakeBusy || !names.length;
      };
      files.addEventListener('change', chosen);
      for (const type of ['dragenter', 'dragover']) drop.addEventListener(type, event => { event.preventDefault(); drop.classList.add('dragging'); });
      for (const type of ['dragleave', 'drop']) drop.addEventListener(type, () => drop.classList.remove('dragging'));
      drop.addEventListener('drop', event => { event.preventDefault(); if (event.dataTransfer?.files?.length) { files.files = event.dataTransfer.files; chosen(); } });
      form.append(files, drop, submit);
      form.addEventListener('submit', event => {
        event.preventDefault();
        const selected = Array.from(files.files);
        if (!selected.length) return;
        importAction(async () => {
          for (const file of selected) {
            if (file.size > serverState.max_upload_bytes) throw new Error(file.name + ' 超过文件大小限制');
            const result = await localRequest('/api/import?filename=' + encodeURIComponent(file.name), {method: 'POST', body: file});
            if (result.job.status === 'failed') throw new Error(result.job.error || '预处理失败，原始材料已保留');
          }
        });
      });
    } else {
      const url = element('input');
      url.id = 'minutes-url'; url.type = 'url'; url.required = true; url.placeholder = 'https://…feishu.cn/minutes/…';
      url.setAttribute('aria-label', '飞书妙记链接'); url.disabled = intakeBusy;
      const row = element('div', null, 'intake-inline'); row.append(url, submit);
      form.append(row, element('p', '用本机飞书账号读取这场妙记的逐字稿，需要你对它有查看和导出权限。', 'inline-note'));
      form.addEventListener('submit', event => {
        event.preventDefault();
        const minutes = url.value;
        importAction(() => localRequest('/api/feishu', {method: 'POST', body: JSON.stringify({minutes, media: false})}));
      });
    }
    submit.disabled = submit.disabled || intakeBusy;
    card.append(sources, form);
    if (intakeBusy) { const progress = element('progress'); progress.setAttribute('aria-label', '素材预处理中'); card.append(progress); }
    if (intakeMessage) { const message = element('p', intakeMessage, 'inline-note'); message.setAttribute('role', 'status'); card.append(message); }
    content.append(card);
    const jobs = panel('最近导入');
    const present = new Set((project.materials || []).map(item => item.material_id));
    const pendingTasks = (serverState.tasks || []).filter(task => task.kind === 'analysis' && task.status !== 'completed');
    for (const job of [...serverState.jobs].reverse()) {
      const row = element('section', null, 'intake-row');
      const analysis = analysisFor(job);
      const state = job.status === 'failed' ? '处理失败' : job.status === 'awaiting_transcript' && !hasTranscript(job) ? '等待逐字稿'
        : present.has(job.material_id) ? '已在当前版本' : analysis?.status === 'waiting_host' || analysis?.status === 'running' ? '分析中' : '待生成新版本';
      const info = element('div', null, 'intake-row-info');
      info.append(element('strong', job.name), element('span', [job.kind === 'recording' ? '录音' : '逐字稿', job.source_count ? job.source_count + ' 段原话' : '', state].filter(Boolean).join(' · ')));
      const actions = element('div', null, 'intake-row-actions');
      if (job.status === 'failed') {
        const retry = element('button', '重试', 'button small'); retry.type = 'button'; retry.disabled = intakeBusy;
        retry.addEventListener('click', () => importAction(() => localRequest('/api/retry', {method: 'POST', body: JSON.stringify({job_id: job.job_id})})));
        actions.append(retry);
      } else if (state === '待生成新版本') {
        const generate = element('button', '生成新版本', 'button primary small'); generate.type = 'button'; generate.disabled = workflowBusy;
        generate.addEventListener('click', () => workflowAction(() => localRequest('/api/analysis', {method: 'POST', body: JSON.stringify({job_ids: [job.job_id], context_job_ids: [], version: nextVersion()})})));
        actions.append(generate);
      } else if (job.status === 'awaiting_transcript' && serverState.asr_configured) {
        const asr = element('button', '转写', 'button small'); asr.type = 'button'; asr.disabled = intakeBusy;
        asr.addEventListener('click', () => importAction(() => localRequest('/api/transcribe', {method: 'POST', body: JSON.stringify({job_id: job.job_id})})));
        actions.append(asr);
      } else if (job.source_count) {
        const view = element('button', '查看原话', 'button ghost small'); view.type = 'button';
        view.addEventListener('click', () => { materialTab = 'library'; render(); });
        actions.append(view);
      }
      row.append(info, actions);
      if (job.error) row.append(element('p', job.error, 'inline-note intake-row-note'));
      jobs.append(row);
    }
    if (!serverState.jobs.length) jobs.append(empty('还没有导入的会议'));
    // Analysis waits for the host model; show it here with the one action that finishes it.
    for (const task of pendingTasks) {
      const row = element('section', null, 'intake-row');
      const info = element('div', null, 'intake-row-info');
      info.append(element('strong', task.version + ' · 等待 Skill 分析'), element('span', task.error || '宿主执行 Skill 后返回 project.json，或在此上传'));
      const actions = element('div', null, 'intake-row-actions');
      if (serverState.analysis_configured) {
        const execute = element('button', '开始分析', 'button primary small'); execute.type = 'button'; execute.disabled = workflowBusy;
        execute.addEventListener('click', () => workflowAction(() => localRequest('/api/analysis/execute', {method: 'POST', body: JSON.stringify({request_id: task.id})})));
        actions.append(execute);
      }
      const file = element('input'); file.type = 'file'; file.accept = '.json'; file.className = 'sr-only'; file.id = 'result-' + task.id;
      const upload = element('label', '上传结果', 'button small'); upload.htmlFor = file.id;
      file.addEventListener('change', () => {
        const selected = file.files[0]; if (!selected) return;
        workflowAction(async () => localRequest('/api/analysis/complete', {method: 'POST', body: JSON.stringify({request_id: task.id, project: JSON.parse(await selected.text())})}));
      });
      actions.append(file, upload);
      row.append(info, actions); jobs.append(row);
    }
    if (workflowMessage) { const message = element('p', workflowMessage, 'inline-note'); message.setAttribute('role', 'status'); jobs.append(message); }
    content.append(jobs);
  }
  function nextVersion() {
    const occupied = new Set((serverState?.tasks || []).map(task => task.version));
    let value = project.artifact_version;
    do {
      const match = /^(.*?)(\d+)$/.exec(value);
      value = match ? match[1] + String(Number(match[2]) + 1) : value + '-next';
    } while (occupied.has(value));
    return value;
  }
  async function workflowAction(action) {
    workflowBusy = true; workflowMessage = '正在处理任务…'; render();
    try {
      const result = await action();
      workflowMessage = result.message ? result.message : result.release ? '客户交付包已生成，可预览或下载' : result.task.status === 'completed' ? '新版本已生成，可从任务记录打开' : '分析请求已准备，等待宿主执行 Skill 并返回项目结果';
      const failures = result.task?.generation_results?.filter(item => item.generation_status === 'failed') || [];
      if (failures.length) workflowMessage = '版本已生成，成果生成失败 · ' + failures.map(item => item.error).join('；');
    } catch (error) { workflowMessage = error.message; }
    finally {
      workflowBusy = false;
      try { await refreshLocal(); } catch (error) { workflowMessage += ' · ' + error.message; }
      render();
    }
  }
  function materials() {
    if (materialTab === 'processing') materialTab = 'import';
    const materialTabs = sectionTabs([['library', '素材', 'materials'], ['import', '导入', 'upload']], materialTab, '会议素材视图', key => { materialTab = key; render(); });
    materialTabs.classList.add('page-tabs'); content.append(materialTabs);
    if (materialTab === 'import') { intakePanel(); return; }
    const entries = [];
    const assigned = new Set();
    // A recording linked from a transcript plays inside that transcript; it is not a meeting of its own.
    const linkedRecordings = new Set((project.materials || []).map(item => item.provenance?.related_job_id).filter(Boolean));
    for (const material of project.materials || []) {
      if (material.kind === 'recording' && linkedRecordings.has(material.job_id)) continue;
      const sources = data.sources.filter(source => (material.source_ids || []).includes(source.source_id) || source.material_id === material.material_id);
      sources.forEach(source => assigned.add(source.source_id));
      const meetings = (project.meetings || []).filter(meeting => (meeting.material_ids || []).includes(material.material_id));
      entries.push({key: 'material:' + material.material_id, title: meetings[0]?.title || material.name || material.material_id, meta: ({transcript: '逐字稿', recording: '音视频', context: '前情资料'}[material.kind] || material.kind || '素材') + ' · ' + sources.length + ' 段原话', material, sources, meetings});
    }
    const groups = new Map();
    data.sources.filter(source => !['project_metadata', 'manual_document_edit'].includes(source.source_type) && !assigned.has(source.source_id)).forEach(source => {
      const key = source.material_id || source.source_name || 'transcript';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(source);
    });
    groups.forEach((sources, key) => entries.push({key: 'source:' + key, title: sources[0].source_name || '会议原话', meta: sources.length + ' 段原话', sources, meetings: (project.meetings || []).filter(meeting => (meeting.material_ids || []).includes(key))}));
    if (project.context_sources.length) entries.push({key: 'context', title: '前情资料', meta: project.context_sources.length + ' 项背景资料', sources: [], meetings: [], context: project.context_sources});
    const selected = entries.find(item => selectedSource && item.sources.some(source => source.source_id === selectedSource))
      || entries.find(item => item.key === selectedMaterial) || entries[0];
    if (!selected) { content.append(empty('暂无会议素材')); return; }
    selectedMaterial = selected.key;

    const meeting = selected.meetings[0];
    const details = element('div', null, 'selection-detail meeting-workspace');
    const card = element('section', null, 'meeting-reader');
    const toolbar = element('div', null, 'meeting-filebar');
    const selector = element('select'); selector.id = 'meeting-material'; selector.setAttribute('aria-label', '选择会议素材');
    for (const entry of entries) {
      const option = element('option', entry.title); option.value = entry.key; selector.append(option);
    }
    selector.value = selected.key;
    selector.addEventListener('change', () => {
      selectedMaterial = selector.value; selectedSource = null; materialPage = 0; materialReader = 'highlights'; materialQuery = '';
      render(); document.getElementById('meeting-material').focus();
    });
    const metadata = [meeting?.date, meeting?.duration_label, selected.meta].filter(Boolean);
    // A single meeting needs no picker; show its name as plain text.
    const picker = entries.length > 1 ? selector : element('strong', selected.title, 'meeting-name');
    toolbar.append(picker, iconLabel(element('span', metadata.join(' · '), 'material-metadata'), 'clock'));
    const attached = data.attachments.find(item => item.material_id === selected.material?.material_id);
    const actions = element('div', null, 'document-actions');
    if (attached) {
      const download = fileLink(attached.path, selected.material?.kind === 'recording' ? '下载素材' : '下载逐字稿');
      download.download = selected.material?.name || attached.path.split('/').at(-1);
      actions.append(download);
    }
    if (meeting?.url) {
      try {
        const url = new URL(meeting.url);
        if (url.protocol === 'https:' && (url.hostname === 'feishu.cn' || url.hostname.endsWith('.feishu.cn') || url.hostname.endsWith('.larksuite.com'))) {
          const link = element('a', '打开飞书妙记', 'button small');
          link.href = url.href; link.target = '_blank'; link.rel = 'noopener'; actions.append(link);
        }
      } catch { /* Keep the original URL in project data. */ }
    }
    toolbar.append(actions);
    content.append(toolbar, details);
    details.append(card);
    if (selected.context) { card.append(valueNode(selected.context)); return; }

    const highlights = (meeting?.highlights || []).filter(item => item.text && item.source_refs?.every(id => sourceMap.has(id)));
    const transcriptMode = materialReader === 'transcript' || materialQuery.trim() || !highlights.length;
    const readingTools = element('div', null, 'meeting-reading-tools');
    if (highlights.length) {
      readingTools.append(sectionTabs([['highlights', '会议重点'], ['transcript', '逐字稿']], transcriptMode ? 'transcript' : 'highlights', '会议阅读方式', key => {
        materialReader = key; selectedSource = null; materialPage = 0; materialQuery = ''; render();
      }));
    } else readingTools.append(element('h2', '逐字稿'));
    const search = element('input', null, 'meeting-search');
    search.id = 'meeting-search'; search.type = 'search'; search.placeholder = '搜索本次会议原话';
    search.setAttribute('aria-label', search.placeholder); search.value = materialQuery;
    search.addEventListener('input', () => {
      const cursor = search.selectionStart;
      materialQuery = search.value; materialPage = 0; selectedSource = null;
      render();
      const current = document.getElementById('meeting-search');
      current.focus(); current.setSelectionRange(cursor, cursor);
    });
    readingTools.append(compactSearch(search)); card.append(readingTools);
    if (transcriptMode) {
      meetingTranscript(card, selected, attached);
      if (selectedSource) card.querySelector('.source-selected')?.scrollIntoView?.({block: 'nearest'});
      return;
    }

    const statuses = {decided: '已明确', conditional: '条件答复', proposal: '提议', pending: '待确认'};
    const list = element('table', null, 'meeting-highlights');
    list.setAttribute('aria-label', '会议重点');
    const head = list.createTHead().insertRow();
    // The status column (已明确／条件答复／提议／待确认) only appears when the analysis recorded a status.
    const statusOf = highlight => Object.hasOwn(statuses, highlight.status) ? highlight.status : {明确行动: 'decided', 已明确: 'decided', 条件答复: 'conditional', 提议: 'proposal', 待确认: 'pending'}[/^【(明确行动|已明确|条件答复|提议|待确认)】/.exec(highlight.text)?.[1]];
    const showStatus = highlights.some(statusOf);
    list.classList.toggle('without-status', !showStatus);
    for (const label of [...(showStatus ? ['状态'] : []), '会议结论', '原话']) {
      const cell = element('th', label); cell.scope = 'col';
      if (label === '原话') cell.replaceChildren(iconLabel(element('span', label), 'quote'));
      head.append(cell);
    }
    const rows = list.createTBody();
    for (const [index, highlight] of highlights.entries()) {
      const row = rows.insertRow(); row.className = 'meeting-highlight';
      const selectedRow = highlight.source_refs.includes(selectedSource) && (selectedHighlight === null || selectedHighlight === index);
      row.classList.toggle('meeting-highlight-selected', selectedRow);
      const prefix = /^【(明确行动|已明确|条件答复|提议|待确认)】/.exec(highlight.text);
      const legacy = {明确行动: 'decided', 已明确: 'decided', 条件答复: 'conditional', 提议: 'proposal', 待确认: 'pending'};
      const status = Object.hasOwn(statuses, highlight.status) ? highlight.status : legacy[prefix?.[1]];
      if (showStatus) {
        const marker = element('span', statuses[status] || '未标注', 'meeting-status' + (status ? ' status-' + status : ''));
        if (status) iconLabel(marker, status);
        row.insertCell().append(marker);
      }
      row.insertCell().textContent = prefix ? highlight.text.slice(prefix[0].length).trim() : highlight.text;
      const citations = row.insertCell();
      for (const id of highlight.source_refs) {
        const button = sourceLink(id, index);
        button.textContent = locatorLabel(sourceMap.get(id).locator) + ' →';
        button.setAttribute('aria-label', locatorLabel(sourceMap.get(id).locator) + ' 查看原话');
        if (selectedRow && id === selectedSource) button.setAttribute('aria-current', 'true');
        citations.append(button);
      }
    }
    card.append(list);
    if (!selectedSource || !selected.sources.some(source => source.source_id === selectedSource)) return;

    const inspector = element('aside', null, 'meeting-evidence');
    inspector.setAttribute('aria-labelledby', 'meeting-evidence-title');
    const header = element('div', null, 'meeting-evidence-head');
    const title = iconLabel(element('h2', '会议原话'), 'quote'); title.id = 'meeting-evidence-title'; title.tabIndex = -1;
    const close = iconLabel(element('button', '关闭', 'button small'), 'close'); close.type = 'button'; close.setAttribute('aria-label', '关闭会议原话');
    const dismiss = () => {
      const previous = selectedSource;
      const rowIndex = selectedHighlight;
      selectedSource = null; selectedHighlight = null; render();
      const origin = rowIndex === null ? content : content.querySelectorAll('.meeting-highlight')[rowIndex];
      const opener = [...(origin?.querySelectorAll('[data-source-ref]') || [])].find(button => button.dataset.sourceRef === previous);
      (opener || document.getElementById('meeting-material')).focus();
    };
    close.addEventListener('click', dismiss);
    inspector.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
    });
    header.append(title, close);
    inspector.append(header, element('p', selected.title, 'material-metadata'));
    const full = iconLabel(element('button', '打开完整逐字稿', 'source-link'), 'documents'); full.type = 'button';
    full.addEventListener('click', () => { materialReader = 'transcript'; render(); focusSource(); });
    inspector.append(full);
    details.classList.add('with-evidence'); details.append(splitter(details), inspector);
    meetingTranscript(inspector, selected, attached, true);
  }
  // Drag (or arrow keys) to resize the quote panel; the width is remembered in this browser only.
  function splitter(container) {
    const key = 'workbench:evidence-width';
    const handle = element('div', null, 'pane-splitter');
    handle.setAttribute('role', 'separator'); handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', '拖动调整原话面板宽度'); handle.tabIndex = 0;
    const apply = width => {
      const bounds = container.getBoundingClientRect().width || 1200;
      const value = Math.round(Math.min(Math.max(width, 240), bounds * 0.6));
      container.style.setProperty('--evidence-width', value + 'px');
      handle.setAttribute('aria-valuenow', String(value));
      return value;
    };
    let saved = 0;
    try { saved = Number(localStorage.getItem(key)) || 0; } catch { /* storage unavailable */ }
    if (saved) apply(saved);
    const remember = value => { try { localStorage.setItem(key, String(value)); } catch { /* storage unavailable */ } };
    handle.addEventListener('pointerdown', event => {
      event.preventDefault(); handle.setPointerCapture?.(event.pointerId); container.classList.add('resizing');
      const move = moveEvent => apply(container.getBoundingClientRect().right - moveEvent.clientX);
      const stop = () => { container.classList.remove('resizing'); handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', stop); remember(Number(handle.getAttribute('aria-valuenow'))); };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', stop);
    });
    handle.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const current = Number(handle.getAttribute('aria-valuenow')) || container.querySelector('.meeting-evidence')?.getBoundingClientRect().width || 320;
      remember(apply(current + (event.key === 'ArrowLeft' ? 24 : -24)));
    });
    return handle;
  }

  function meetingTranscript(host, selected, attached, contextOnly = false) {
    const relatedId = selected.material?.provenance?.related_job_id;
    const recording = relatedId ? (project.materials || []).find(item => item.job_id === relatedId || item.path?.startsWith(relatedId + '/')) : null;
    const recordingAttachment = data.attachments.find(item => item.material_id === recording?.material_id);
    const mediaAttachment = recordingAttachment || attached;
    const mediaPattern = /\.(mp3|wav|m4a|aac|ogg|flac|mp4|mov|webm|mkv)$/i;
    let mediaPath = mediaPattern.test(mediaAttachment?.path || '') ? '../' + mediaAttachment.path.split('/').map(encodeURIComponent).join('/') : null;
    if (!mediaPath && relatedId && serverState) {
      const job = serverState.jobs.find(item => item.job_id === relatedId && item.kind === 'recording' && item.status !== 'failed');
      if (job?.files.original) mediaPath = '/api/jobs/' + job.job_id + '/original';
    }
    const mediaName = recordingAttachment?.path || attached?.path || serverState?.jobs.find(item => item.job_id === relatedId)?.files.original || '';
    const player = mediaPath ? element(/\.(mp4|mov|webm|mkv)$/i.test(mediaName) ? 'video' : 'audio') : null;
    const seekMessage = element('p', '', 'inline-note');
    seekMessage.setAttribute('role', 'status');
    let seekTarget = null;
    function applySeek() {
      if (seekTarget === null) return;
      const target = seekTarget;
      seekTarget = null;
      if (Number.isFinite(player.duration) && target > player.duration) {
        seekMessage.textContent = '原话时间超出录音长度，请核对逐字稿与录音是否匹配';
        return;
      }
      try {
        player.currentTime = target;
        seekMessage.textContent = '已定位到 ' + locatorLabel({start_seconds: target});
        player.focus();
      } catch { seekMessage.textContent = '录音定位失败，请核对文件是否可播放'; }
    }
    if (player) {
      player.controls = true;
      player.preload = 'metadata';
      player.src = mediaPath;
      player.setAttribute('aria-label', '来源录音');
      player.addEventListener('loadedmetadata', applySeek);
      player.addEventListener('error', () => { seekMessage.textContent = '录音无法加载，请核对文件与浏览器支持的格式'; });
      host.append(player, seekMessage);
    }
    const transcriptSources = selected.sources.filter(source => !materialQuery.trim() || JSON.stringify(source).toLowerCase().includes(materialQuery.trim().toLowerCase()));
    const selectedIndex = transcriptSources.findIndex(source => source.source_id === selectedSource);
    if (selectedIndex >= 0) materialPage = Math.floor(selectedIndex / 30);
    const pageCount = Math.max(1, Math.ceil(transcriptSources.length / 30));
    materialPage = Math.min(materialPage, pageCount - 1);
    const paging = element('div', null, 'transcript-paging');
    for (const [label, offset] of [['上一页', -1], ['下一页', 1]]) {
      const button = element('button', label, 'button small'); button.type = 'button';
      button.disabled = materialPage + offset < 0 || materialPage + offset >= pageCount;
      button.addEventListener('click', () => { materialPage += offset; selectedSource = null; render(); });
      paging.append(button);
    }
    paging.append(element('span', (materialPage + 1) + ' / ' + pageCount + ' 页 · ' + transcriptSources.length + ' 段原话'));
    if (!contextOnly && pageCount > 1) host.append(paging);
    const excerpts = contextOnly
      ? transcriptSources.slice(Math.max(0, selectedIndex - 1), selectedIndex + 2)
      : transcriptSources.slice(materialPage * 30, (materialPage + 1) * 30);
    // Transcript reads like a conversation: time · speaker · words on one line; the speaker shows only when it changes.
    const speakerOrder = [];
    let previousSpeaker = null;
    excerpts.forEach(source => {
      const speakerPrefix = /^([\p{Script=Han}]{2,8}|说话人\s*\d+|Speaker\s*\d+)[：:]\s*/u.exec(source.text);
      const speaker = source.speaker || speakerPrefix?.[1] || '说话人待确认';
      const words = (speakerPrefix ? source.text.slice(speakerPrefix[0].length) : source.text).trim();
      if (!words && source.source_id !== selectedSource) return;
      const excerpt = element('section', null, 'source-excerpt' + (contextOnly ? '' : ' transcript-line'));
      if (source.source_id === selectedSource) { excerpt.classList.add('source-selected'); excerpt.tabIndex = -1; }
      excerpt.dataset.sourceId = source.source_id;
      if (!speakerOrder.includes(speaker)) speakerOrder.push(speaker);
      if (contextOnly) badges(excerpt, [locatorLabel(source.locator), speaker]);
      else {
        excerpt.append(element('span', locatorLabel(source.locator), 'line-time'));
        const who = element('span', speaker === previousSpeaker ? '' : speaker, 'line-speaker');
        who.dataset.tone = String(speakerOrder.indexOf(speaker) % 4);
        excerpt.append(who);
      }
      previousSpeaker = speaker;
      excerpt.append(element('blockquote', words || '（无内容）', 'source-quote'));
      const links = element('div', null, 'source-actions');
      if (player && Number.isFinite(source.locator.start_seconds)) {
        const seek = iconLabel(element('button', '定位录音 ' + locatorLabel(source.locator), 'button small'), 'clock');
        seek.type = 'button';
        seek.dataset.sourceId = source.source_id;
        seek.addEventListener('click', () => {
          seekTarget = source.locator.start_seconds;
          if (player.readyState >= 1) applySeek();
          else { seekMessage.textContent = '正在加载录音时间信息…'; player.load(); }
        });
        links.append(seek);
      }
      const linked = requirements.filter(req => req.source_refs.includes(source.source_id));
      linked.forEach(req => links.append(requirementLink(req)));
      if (links.childElementCount) excerpt.append(links);
      host.append(excerpt);
    });
    if (!transcriptSources.length) host.append(element('p', materialQuery.trim() ? '没有匹配的原话' : '当前素材尚无可定位的原话片段', 'inline-note'));
  }
  function moduleDetails(group, host) {
    host.replaceChildren();
    const head = element('div', null, 'module-detail-head');
    const heading = element('h2'); heading.append(element('span', '模块', 'module-kicker'), document.createTextNode(group.title));
    head.append(heading, element('span', group.items.length + ' 条需求，左侧选择一条查看', 'module-count'));
    head.append(sectionTabs([['requirements', '需求'], ['related', '相关内容']], moduleDetailTab, '模块内容', key => { moduleDetailTab = key; moduleDetails(group, host); }));
    host.append(head);
    if (moduleDetailTab === 'related') {
      const reqIds = new Set(group.items.map(req => req.requirement_id));
      const related = element('div', null, 'module-related');
      related.setAttribute('aria-label', '关联成果');
      const pages = project.pages.filter(page => (page.requirement_ids || []).some(id => reqIds.has(id)));
      const entities = (project.business_model.entities || []).filter(item => (item.requirement_ids || []).some(id => reqIds.has(id)));
      const apis = (project.apis || []).filter(item => (item.requirement_ids || []).some(id => reqIds.has(id)));
      const relations = (project.module_relations || []).filter(item => item.from === group.module?.module_id || item.to === group.module?.module_id);
      for (const [items, label, title, view] of [[pages, '页面', item => item.name || item.page_id, 'prototype'], [entities, '数据', item => item.name || item.entity_id, 'database'], [apis, '接口', item => item.name || item.api_id, 'api']]) {
        items.forEach(item => {
          const button = element('button', label + ' · ' + title(item), 'related-chip');
          button.type = 'button'; button.addEventListener('click', () => navigate(view)); related.append(button);
        });
      }
      relations.forEach(item => {
        const other = (project.modules || []).find(module => module.module_id === (item.from === group.module?.module_id ? item.to : item.from));
        related.append(element('p', (item.from === group.module?.module_id ? '→ ' : '← ') + (other?.name || other?.module_id) + ' · ' + item.label, 'inline-note'));
      });
      host.append(related.children.length ? related : empty('暂无关联内容'));
      return;
    }
    const current = group.items.find(req => req.requirement_id === selectedRequirement) || group.items[0];
    if (!current) { host.append(empty('该模块尚无匹配需求')); return; }
    selectedRequirement = current.requirement_id;
    const workspace = element('div', null, 'module-requirements');
    const choices = element('nav', null, 'requirement-picker');
    choices.setAttribute('aria-label', '选择需求');
    group.items.forEach(req => {
      choices.append(requirementChoice(req, current, () => {
        selectedRequirement = req.requirement_id; requirementTab = 'detail';
        moduleDetails(group, host); host.querySelector('.requirement-choice[aria-pressed="true"]')?.focus();
      }));
    });
    workspace.append(choices, requirementCard(current));
    host.append(workspace);
  }
  function svgNode(tag, attributes = {}, text) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function workbenchDiagramPalette() {
    const tokens = getComputedStyle(document.documentElement);
    const color = name => tokens.getPropertyValue('--ui-' + name).trim();
    return `
      .diagram-container {
        --backend-fill: ${color('accent-soft')};
        --backend-stroke: ${color('diagram-node')};
        --canvas-dot: ${color('border')};
        --arrow: ${color('diagram-line')};
      }
      [data-node-id][data-workbench-selected] { filter: none !important; }
      [data-workbench-selected] .c-backend { fill: ${color('accent-soft-strong')}; stroke: ${color('accent')}; stroke-width: 2.5px; }
      [data-node-id]:focus-visible .c-backend { stroke: ${color('accent')}; stroke-width: 2.5px; }
      .t-primary { fill: ${color('ink')}; }
      .t-muted, .t-edge-default { fill: ${color('muted')}; }
      .t-backend { fill: ${color('accent-ink')}; }
    `;
  }
  function useCaseDiagram(groups, onSelect) {
    const items = groups.flatMap(group => group.items.map(req => ({req, group}))).filter((item, index, all) => all.findIndex(other => other.req.requirement_id === item.req.requirement_id) === index && item.req.lifecycle_status !== 'cancelled' && item.req.review_status !== 'parked');
    const roleList = req => (Array.isArray(req.role) ? req.role : req.role ? [req.role] : []).filter(role => typeof role === 'string' && role.trim());
    const roles = [...new Set(items.flatMap(item => roleList(item.req)))];
    if (!items.length || !roles.length) return empty('角色与功能关系待补充');
    const height = Math.max(240, items.length * 76 + 80, roles.length * 120 + 50);
    const svg = svgNode('svg', {viewBox: '0 0 920 ' + height, role: 'group', 'aria-label': '用例图：角色与功能'});
    svg.append(svgNode('rect', {x: 310, y: 18, width: 590, height: height - 36, rx: 12, class: 'usecase-boundary'}));
    svg.append(svgNode('text', {x: 330, y: 45, class: 'diagram-label'}, project.name || '功能范围'));
    const rolePositions = new Map(roles.map((role, index) => [role, 70 + index * ((height - 120) / Math.max(1, roles.length - 1))]));
    items.forEach(({req}, index) => roleList(req).forEach(role => svg.append(svgNode('line', {x1: 150, y1: rolePositions.get(role) + 24, x2: 450, y2: 90 + index * 76, class: 'usecase-link'}))));
    roles.forEach(role => {
      const y = rolePositions.get(role);
      const actor = svgNode('g'); actor.append(svgNode('circle', {cx: 125, cy: y, r: 12, class: 'usecase-actor'}));
      actor.append(svgNode('path', {d: `M125 ${y + 12}v32m-22 -20h44m-22 20l-20 27m20 -27l20 27`, class: 'usecase-actor'}));
      actor.append(svgNode('text', {x: 125, y: y + 92, 'text-anchor': 'middle', class: 'diagram-label'}, role)); svg.append(actor);
    });
    items.forEach(({req, group}, index) => {
      const y = 90 + index * 76;
      const node = svgNode('g', {role: 'button', tabindex: 0, 'aria-label': '查看功能：' + req.title, 'data-usecase-id': req.requirement_id});
      node.append(svgNode('ellipse', {cx: 660, cy: y, rx: 210, ry: 27, class: 'usecase-function'}));
      node.append(svgNode('text', {x: 660, y: y + 5, 'text-anchor': 'middle', class: 'diagram-label'}, req.title));
      const choose = () => onSelect(group.key, req.requirement_id);
      node.addEventListener('click', choose); node.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') {event.preventDefault(); choose();} }); svg.append(node);
    });
    const wrapper = element('div', null, 'content-diagram'); wrapper.append(svg); return wrapper;
  }
  function architectureDetails(architecture, frame = null) {
    const nodes = architecture.components;
    const host = element('div', null, 'architecture-details');
    const picker = element('nav', null, 'module-filters'); picker.setAttribute('aria-label', '技术组件');
    const detail = element('section', null, 'panel architecture-inspector'); detail.setAttribute('aria-label', '组件详情');
    nodes.forEach(node => {
      const button = element('button', node.name, 'module-filter'); button.type = 'button'; button.dataset.componentId = node.id;
      button.addEventListener('click', () => select(node.id)); picker.append(button);
    });
    // Nothing is selected on arrival: the card appears once a component is picked in the diagram.
    const hint = element('p', '点选图中的组件，查看它的开发内容和交付标准', 'inline-note diagram-hint');
    detail.hidden = true;
    function select(id, reveal = false) {
      const node = nodes.find(item => item.id === id); if (!node) return;
      selectedArchitecture = id; detail.hidden = false; hint.remove();
      picker.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.componentId === id)));
      detail.replaceChildren(element('h2', node.name)); detail.dataset.componentId = id;
      const layer = architecture.layers.find(item => item.id === node.layer);
      detail.append(element('p', [layer?.name, node.runtime].filter(Boolean).join(' · '), 'inline-note'));
      if (node.responsibility) detail.append(element('p', node.responsibility));
      const columns = element('div', null, 'component-deliverables');
      for (const [key, title] of [['development_items', '开发内容'], ['delivery_criteria', '交付标准']]) {
        const section = element('section'); section.append(element('h3', title));
        if (node[key]?.length) section.append(valueNode(node[key])); else section.append(element('p', '待补充', 'inline-note'));
        columns.append(section);
      }
      detail.append(columns);
      const related = requirements.filter(req => (node.requirement_ids || []).includes(req.requirement_id));
      if (related.length) {
        const links = element('div', null, 'component-requirements'); links.append(element('h3', '关联需求'));
        related.forEach(req => links.append(requirementLink(req))); detail.append(links);
      }
      frame?.contentWindow?.postMessage({type: 'product-requirements:architecture-state', selected: nodes.indexOf(node)}, '*');
      if (reveal) detail.querySelector('h2')?.scrollIntoView?.({block: 'nearest'});
    }
    // With the live diagram, nodes are clicked in the diagram itself; the chip row is only kept for the plain SVG fallback.
    host.append(...(frame ? [] : [picker]), hint, detail);
    if (nodes.some(node => node.id === selectedArchitecture)) select(selectedArchitecture);
    return {host, select};
  }
  function technicalArchitecture() {
    const architecture = project.technical_architecture;
    if (!architecture?.components?.length) { content.append(empty('技术架构待确认')); return; }
    if (data.architecture_diagram) {
      const card = element('section', null, 'panel diagram-card'); card.setAttribute('aria-label', '技术架构');
      // The diagram speaks for itself: no title bar, just an icon to open it on its own page.
      card.append(diagramOpenIcon('diagrams/architecture.html', '在新页面打开技术架构图'));
      const frame = element('iframe', null, 'architecture-preview'); frame.title = 'Archify 技术架构'; frame.setAttribute('sandbox', 'allow-scripts');
      const details = architectureDetails(architecture, frame);
      const bridge = `(() => {
        const style = document.createElement('style'); style.textContent = 'html,body{background:#fdfefe;min-height:0 !important;margin:0;padding:0 !important} body > .toolbar,.container > .header,.diagram-nav,.reader-rail,.rail-reveal,#focus-chip,.cards{display:none !important} .container{padding:0;max-width:none} .diagram-container{padding:0;border:0;box-shadow:none;margin:0;min-height:0 !important} .diagram-container > svg{display:block;width:100%;height:auto;min-width:0 !important} @media(max-width:480px){.diagram-container > svg{min-width:620px !important}} svg [data-node-id] text.t-primary{font-size:17px;transform:translateY(-5px)} svg [data-node-id] text.t-muted{font-size:12px} svg [data-node-id] text.t-backend{font-size:10px;opacity:1 !important} [data-node-id]{cursor:pointer} '; style.textContent += ${JSON.stringify(workbenchDiagramPalette())}; document.head.append(style);
        const legend = document.querySelector('svg [data-legend]'); const drawing = legend?.ownerSVGElement; if (legend && drawing?.viewBox?.baseVal?.height) { const top = legend.getBBox().y; legend.remove(); if (top > 80) drawing.viewBox.baseVal.height = top - 12; }
        const target = document.querySelector('.diagram-container');
        const report = () => {if(target)parent.postMessage({type:'product-requirements:architecture-size',height:Math.ceil(target.getBoundingClientRect().height)},'*');};
        if(target)new ResizeObserver(report).observe(target); report();
        function notify(event) {
          const node = event.target.closest('[data-node-id]'); if (!node) return;
          event.preventDefault(); event.stopPropagation();
          parent.postMessage({type:'product-requirements:architecture-select',id:node.getAttribute('data-node-id')},'*');
        }
        target?.querySelector('svg')?.setAttribute('role','group');
        document.querySelectorAll('[data-node-id]').forEach(node => {node.setAttribute('role','button');node.setAttribute('tabindex','0');node.setAttribute('aria-label','查看组件：'+(node.querySelector('.t-primary')?.textContent || node.getAttribute('data-node-id')));});
        document.addEventListener('click',notify,true);
        document.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')notify(event);},true);
        window.addEventListener('message',event=>{if(event.source!==parent||event.data?.type!=='product-requirements:architecture-state')return;document.querySelectorAll('[data-node-id]').forEach(node=>{const selected=node.getAttribute('data-node-id')==='component_'+event.data.selected;node.toggleAttribute('data-workbench-selected',selected);node.setAttribute('aria-pressed',String(selected));});});
      })();`;
      const resize = event => {
        if (!frame.isConnected) {window.removeEventListener('message', resize); return;}
        if (event.source === frame.contentWindow && event.data?.type === 'product-requirements:architecture-select' && /^component_\d+$/.test(event.data.id)) {
          const node = architecture.components[Number(event.data.id.slice(10))]; if (node) details.select(node.id, true);
        }
        if (event.source === frame.contentWindow && event.data?.type === 'product-requirements:architecture-size' && Number.isFinite(event.data.height)) frame.style.height = Math.max(200, Math.min(1800, event.data.height)) + 'px';
      };
      window.addEventListener('message', resize);
      frame.srcdoc = data.architecture_diagram.replace('</body>', '<scr' + 'ipt>' + bridge + '</scr' + 'ipt></body>');
      frame.addEventListener('load', () => { if (selectedArchitecture) details.select(selectedArchitecture); });
      card.append(frame); content.append(card, details.host); return;
    }
    const layers = architecture.layers || [];
    const nodes = architecture.components;
    const height = Math.max(280, ...layers.map(layer => nodes.filter(node => node.layer === layer.id).length * 100 + 90));
    const width = Math.max(700, layers.length * 300 + 30);
    const svg = svgNode('svg', {viewBox: `0 0 ${width} ${height}`, role: 'group', 'aria-label': '技术架构：系统组件与连接'});
    const defs = svgNode('defs'); const marker = svgNode('marker', {id: 'architecture-arrow', markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: 'auto'}); marker.append(svgNode('path', {d: 'M0,0 L8,4 L0,8 Z', fill: '#8293a9'})); defs.append(marker); svg.append(defs);
    const positions = new Map();
    layers.forEach((layer, index) => {
      const x = 15 + index * 300;
      svg.append(svgNode('rect', {x, y: 12, width: 280, height: height - 24, rx: 12, class: 'usecase-boundary'}));
      svg.append(svgNode('text', {x: x + 18, y: 40, class: 'diagram-label'}, layer.name));
      nodes.filter(node => node.layer === layer.id).forEach((node, row) => positions.set(node.id, {x: x + 25, y: 65 + row * 100}));
    });
    (architecture.connections || []).forEach(connection => {
      const a = positions.get(connection.from), b = positions.get(connection.to); if (!a || !b) return;
      const forward = b.x > a.x; const same = b.x === a.x;
      const x1 = same ? a.x + 115 : a.x + (forward ? 230 : 0), y1 = a.y + (same ? 62 : 31);
      const x2 = same ? b.x + 115 : b.x + (forward ? 0 : 230), y2 = b.y + (same ? 0 : 31);
      svg.append(svgNode('path', {d: same ? `M${x1},${y1} L${x2},${y2}` : `M${x1},${y1} C${(x1+x2)/2},${y1} ${(x1+x2)/2},${y2} ${x2},${y2}`, class: 'architecture-link', 'marker-end': 'url(#architecture-arrow)'}));
    });
    const details = architectureDetails(architecture);
    nodes.forEach(node => {
      const pos = positions.get(node.id); if (!pos) return;
      const group = svgNode('g', {role: 'button', tabindex: 0, 'aria-label': '查看组件：' + node.name});
      group.addEventListener('click', () => details.select(node.id, true));
      group.addEventListener('keydown', event => {if (event.key === 'Enter' || event.key === ' ') {event.preventDefault(); details.select(node.id, true);}});
      group.append(svgNode('rect', {...pos, width: 230, height: 62, rx: 9, class: 'architecture-component'}));
      group.append(svgNode('text', {x: pos.x + 115, y: pos.y + 27, 'text-anchor': 'middle', class: 'diagram-label'}, node.name));
      if (node.runtime) group.append(svgNode('text', {x: pos.x + 115, y: pos.y + 47, 'text-anchor': 'middle', class: 'diagram-caption'}, node.runtime));
      svg.append(group);
    });
    const card = panel('技术架构');
    if (architecture.review_status !== 'confirmed') card.append(element('span', '设计建议 · 待确认', 'workbench-meta'));
    const wrapper = element('div', null, 'content-diagram'); wrapper.append(svg); card.append(wrapper); content.append(card, details.host);
  }
  function modules() {
    const bar = pendingReviewBar(); if (bar) content.append(bar);
    const visible = filteredRequirements();
    const groups = (project.modules || []).map(module => ({
      key: 'module:' + module.module_id, module, title: module.name || module.module_id,
      items: visible.filter(req => (module.requirement_ids || []).includes(req.requirement_id))
    }));
    const assigned = new Set((project.modules || []).flatMap(module => module.requirement_ids || []));
    const remaining = visible.filter(req => !assigned.has(req.requirement_id));
    if (remaining.length) groups.push({key: 'unassigned', title: '待归类', items: remaining});
    const filtering = queryInput.value || statusInput.value || evidenceInput.value;
    const choices = groups.filter(group => group.items.length || !filtering);
    let selected = choices.find(group => group.key === selectedModule) || choices[0];
    const tools = element('div', null, 'module-toolbar');
    const switcher = element('div', null, 'view-switcher page-tabs'); switcher.setAttribute('role', 'group'); switcher.setAttribute('aria-label', '需求视图');
    for (const [view, label, marker] of [['list', '需求列表', 'modules'], ['map', '业务模块', 'technical'], ['usecases', '用例图', 'actors']]) {
      const button = iconLabel(element('button', label), marker); button.type = 'button'; button.setAttribute('aria-pressed', String(moduleView === view));
      button.addEventListener('click', () => { moduleView = view; render(); content.querySelector('.view-switcher [aria-pressed="true"]')?.focus(); }); switcher.append(button);
    }
    tools.append(switcher, element('span', visible.length + ' / ' + requirements.length + ' 条需求', 'module-count'));
    content.append(tools);
    if (!selected) { content.append(empty('暂无匹配需求，可调整搜索词或筛选条件')); return; }
    selectedModule = selected.key;
    if (moduleView === 'list') {
      const listed = choices.flatMap(group => group.items);
      const nfrs = (project.nfrs || []).filter(matches);
      const current = listed.find(req => req.requirement_id === selectedRequirement) || nfrs.find(item => item.nfr_id === selectedRequirement) || listed[0] || nfrs[0];
      if (!current) { content.append(empty('暂无需求')); return; }
      selectedRequirement = current.requirement_id || current.nfr_id;
      selectedModule = choices.find(group => group.items.includes(current))?.key || selectedModule;
      // Same layout as the documents: a sticky list on the left, one requirement card with a header bar on the right.
      const detail = element('div', null, 'selection-layout document-workspace requirement-list-layout'); detail.setAttribute('aria-label', '需求列表');
      const picker = element('nav', null, 'selection-list doc-toc requirement-picker'); picker.setAttribute('aria-label', '选择需求');
      choices.filter(group => group.items.length).forEach(group => {
        picker.append(iconLabel(element('p', group.title, 'requirement-group'), 'folder'));
        group.items.forEach(req => {
          picker.append(requirementChoice(req, current, () => {
            selectedRequirement = req.requirement_id; requirementTab = 'detail'; render();
            content.querySelector('.requirement-choice[aria-pressed="true"]')?.focus();
          }));
        });
      });
      if (nfrs.length) {
        picker.append(iconLabel(element('p', '非功能需求', 'requirement-group'), 'folder'));
        nfrs.forEach(item => picker.append(requirementChoice(item, current, () => {
          selectedRequirement = item.nfr_id; requirementTab = 'detail'; render();
          content.querySelector('.requirement-choice[aria-pressed="true"]')?.focus();
        })));
      }
      const reader = element('div', null, 'selection-detail');
      reader.append(current.nfr_id ? nfrCard(current) : requirementCard(current)); detail.append(picker, reader); content.append(detail);
      return;
    }
    const filters = element('nav', null, 'module-filters'); filters.setAttribute('aria-label', '业务模块列表');
    const workspace = element('div', null, 'module-workspace');
    const surface = element('section', null, 'module-surface'); surface.setAttribute('aria-label', {map: '业务模块', usecases: '用例图', list: '需求列表'}[moduleView]);
    const detail = element('aside', null, 'module-detail panel requirement-card'); detail.setAttribute('aria-label', '模块详情');
    function select(key, reveal = false) {
      const next = choices.find(group => group.key === key);
      if (!next) return;
      if (key !== selectedModule || reveal) { requirementTab = 'detail'; moduleDetailTab = 'requirements'; }
      selected = next; selectedModule = key;
      for (const button of filters.querySelectorAll('button')) button.setAttribute('aria-current', String(button.dataset.moduleKey === key));
      moduleDetails(selected, detail);
      moduleFrame?.contentWindow?.postMessage({type: 'product-requirements:module-state', selected: (project.modules || []).findIndex(module => module.module_id === selected.module?.module_id), visible: choices.map(group => (project.modules || []).findIndex(module => module.module_id === group.module?.module_id))}, '*');
      if (reveal) detail.querySelector('h2')?.scrollIntoView?.({block: 'nearest'});
    }
    choices.forEach(group => {
      const button = element('button', null, 'module-filter'); button.type = 'button'; button.dataset.moduleKey = group.key;
      button.setAttribute('aria-current', String(group === selected)); button.append(element('span', group.title), element('span', group.items.length, 'module-filter-count'));
      button.addEventListener('click', () => select(group.key, true)); filters.append(button);
    });
    content.append(workspace); workspace.append(surface);
    if (moduleView === 'map' && !data.module_diagram) workspace.append(filters);
    workspace.append(detail);
    if (moduleView === 'usecases') {
      surface.append(useCaseDiagram(choices, (key, requirement) => { selectedRequirement = requirement; select(key, true); }));
    } else if (moduleView === 'map' && data.module_diagram) {
      surface.classList.add('diagram-card'); surface.append(diagramOpenIcon('diagrams/modules.html', '在新页面打开业务模块图'));
      const frame = element('iframe', null, 'module-map'); frame.title = 'Archify 业务模块图'; frame.setAttribute('sandbox', 'allow-scripts');
      frame.style.height = Math.max(300, Math.ceil(project.modules.length / 3) * 160 + 120) + 'px';
      const bridge = `(() => {
        const style = document.createElement('style'); style.textContent = 'html,body {background:#fdfefe;min-height:0 !important;margin:0;padding:0 !important} body > .toolbar, .container > .header, .diagram-nav, .reader-rail, .rail-reveal, #focus-chip, .cards {display:none !important} .container {padding:0;max-width:none} .diagram-container {padding:0;border:0;box-shadow:none;margin:0;min-height:0 !important} .diagram-container > svg {display:block;width:100%;height:auto;min-width:0 !important} @media(max-width:480px){.diagram-container > svg {min-width:620px !important}} svg [data-node-id] text.t-primary {font-size:17px;transform:translateY(-5px)} svg [data-node-id] text.t-muted {font-size:12px} [data-node-id][data-workbench-filtered] {opacity:.22}'; style.textContent += ${JSON.stringify(workbenchDiagramPalette())}; document.head.append(style);
        const legend = document.querySelector('svg [data-legend]'); const drawing = legend?.ownerSVGElement; if (legend && drawing?.viewBox?.baseVal?.height) { const top = legend.getBBox().y; legend.remove(); if (top > 80) drawing.viewBox.baseVal.height = top - 12; }
        const target = document.querySelector('.diagram-container');
        const report = () => {if(target)parent.postMessage({type:'product-requirements:module-size',height:Math.ceil(target.getBoundingClientRect().height)},'*');};
        if(target)new ResizeObserver(report).observe(target); report();
        function notify(event) { const node = event.target.closest('[data-node-id]'); if (node) parent.postMessage({type:'product-requirements:module-select', id:node.getAttribute('data-node-id')}, '*'); }
        document.addEventListener('click', notify, true); document.addEventListener('keydown', event => {if (event.key === 'Enter' || event.key === ' ') notify(event);}, true);
        window.addEventListener('message', event => { if (event.source !== parent || event.data?.type !== 'product-requirements:module-state') return; document.querySelectorAll('[data-node-id]').forEach(node => { const index = Number(node.getAttribute('data-node-id').replace('module_', '')); node.toggleAttribute('data-workbench-selected', index === event.data.selected); node.toggleAttribute('data-workbench-filtered', Array.isArray(event.data.visible) && !event.data.visible.includes(index)); }); });
      })();`;
      frame.srcdoc = data.module_diagram.replace('</body>', '<scr' + 'ipt>' + bridge + '</scr' + 'ipt></body>');
      moduleFrame = frame; selectDiagramModule = index => select('module:' + project.modules[index]?.module_id, true);
      frame.addEventListener('load', () => select(selectedModule));
      surface.append(frame);
      if (!(project.module_relations || []).length) surface.append(element('p', '模块间关系待补充', 'module-map-note'));
    } else if (moduleView === 'map') {
      surface.append(empty('模块图待生成'));
    }
    select(selectedModule);
  }
  function markdownDocument(text) {
    const body = element('div', null, 'document-body');
    let list = null;
    function paragraph(tag, text) {
      const node = element(tag);
      const field = tag === 'li' ? /^([\p{Script=Han}]{2,8})( — )/u.exec(text) : null;
      if (field) {
        node.append(element('strong', field[1]), document.createTextNode(field[2]));
        text = text.slice(field[0].length);
      }
      let offset = 0;
      for (const match of text.matchAll(/(?<!\\)(?:\[([^\]]+)\]\((https:\/\/[^\s)]+|(?:prd|proposal)\.md)\)|\*\*([^*\n]+)\*\*)/g)) {
        node.append(document.createTextNode(unescape(text.slice(offset, match.index))));
        if (match[3]) node.append(element('strong', unescape(match[3])));
        else {
          const link = element('a', unescape(match[1]));
          link.href = match[2].startsWith('https://') ? match[2] : '../' + match[2];
          link.target = '_blank'; link.rel = 'noopener'; node.append(link);
        }
        offset = match.index + match[0].length;
      }
      node.append(document.createTextNode(unescape(text.slice(offset))));
      return node;
    }
    const unescape = value => value.replace(/\\([\\`*_{}\[\]<>()#!|>~])/g, '$1');
    for (const block of text.split(/\n\s*\n/)) {
      const decoded = unescape(block.trim());
      if (decoded.startsWith('[') || decoded.startsWith('{')) {
        try { body.append(valueNode(JSON.parse(decoded))); continue; } catch { /* Render ordinary text literally. */ }
      }
      for (const line of block.split('\n')) {
        const heading = /^(#{1,4}) (.*)$/.exec(line);
        const bullet = /^(\s*)- (.*)$/.exec(line);
        if (heading) {
          list = null;
          body.append(element('h' + Math.min(4, heading[1].length + 1), unescape(heading[2])));
        } else if (bullet) {
          if (!list) { list = element('ul'); body.append(list); }
          const item = paragraph('li', bullet[2]);
          item.style.marginLeft = Math.min(bullet[1].length, 12) * 8 + 'px';
          list.append(item);
        } else {
          list = null;
          if (line.trim()) body.append(paragraph('p', line));
        }
      }
      list = null;
    }
    return body;
  }
  function dataTable(rows) {
    const wrapper = element('div', null, 'data-table-scroll');
    const table = element('table', null, 'data-table');
    const head = element('thead');
    const header = element('tr');
    header.append(element('th', '字段'), element('th', '定义'));
    head.append(header);
    const body = element('tbody');
    for (const [key, value] of rows) {
      const row = element('tr');
      const cell = element('td');
      cell.append(valueNode(value));
      row.append(element('td', key), cell);
      body.append(row);
    }
    table.append(head, body);
    wrapper.append(table);
    return wrapper;
  }
  function printDocument(name) {
    document.querySelector('.document-print-frame')?.remove();
    const frame = element('iframe', null, 'document-print-frame');
    frame.title = '打印文档'; frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
    document.body.append(frame);
    const page = frame.contentDocument;
    page.title = (project.name || project.project_id) + ({'prd.md': ' · PRD', 'agent-prompt.md': ' · 开发提示词'}[name] || ' · 项目方案');
    page.documentElement.lang = 'zh-CN';
    const style = element('style');
    style.textContent = document.querySelector('head style').textContent + '\n@page {size:A4;margin:18mm} body{background:white;color:#202d40} .document-body{max-width:none;margin:0} h2,h3,h4{break-after:avoid} p,li{orphans:3;widows:3}';
    page.head.append(style);
    page.body.append(markdownDocument(documentDrafts[name] ?? data.documents[name]));
    frame.contentWindow.addEventListener('afterprint', () => frame.remove(), {once: true});
    frame.contentWindow.focus(); frame.contentWindow.print();
  }
  function citationButton(id, number) {
    const source = sourceMap.get(id);
    const button = element('button', '[' + number + ']', 'cite'); button.type = 'button';
    button.title = source ? (locatorLabel(source.locator) + ' ' + String(source.text || '').slice(0, 80)) : id;
    button.setAttribute('aria-label', '引用 ' + number + '：' + button.title);
    button.addEventListener('click', () => { if (source) openSource(id); });
    return button;
  }
  function withCitations(node, citeNumber) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const targets = [];
    while (walker.nextNode()) if (/(?:SRC|META)-[0-9a-f]{24}/.test(walker.currentNode.nodeValue)) targets.push(walker.currentNode);
    for (const textNode of targets) {
      const parts = textNode.nodeValue.split(/((?:SRC|META)-[0-9a-f]{24})/);
      const fragment = document.createDocumentFragment();
      for (const part of parts) {
        if (/^(?:SRC|META)-[0-9a-f]{24}$/.test(part)) fragment.append(citationButton(part, citeNumber(part)));
        else if (part.replace(/[、，,\s]/g, '')) fragment.append(part);
      }
      textNode.replaceWith(fragment);
    }
    return node;
  }
  function referenceList(order) {
    const list = element('ol', null, 'reference-list');
    order.forEach((id, index) => {
      const source = sourceMap.get(id);
      const item = element('li'); item.value = index + 1;
      const head = element('span', '[' + (index + 1) + '] ' + (source ? locatorLabel(source.locator) : id), 'reference-head');
      item.append(head, element('span', source?.text || '来源记录缺失', 'reference-text'));
      if (source) item.append(sourceLink(id));
      list.append(item);
    });
    if (!order.length) return element('p', '正文没有引用来源', 'inline-note');
    return list;
  }
  // Documents read top to bottom; the left list jumps to a chapter and follows the scroll position.
  function documents() {
    if (!['proposal.md', 'prd.md'].includes(selectedDocument)) selectedDocument = 'proposal.md';
    const name = selectedDocument;
    const tabs = sectionTabs([['proposal.md', '项目方案', 'documents'], ['prd.md', 'PRD', 'modules']], name, '文档类型', key => { selectedDocument = key; documentChapter = 0; documentEditing = false; documentMessage = ''; render(); });
    tabs.classList.add('document-type-tabs', 'page-tabs');
    content.append(tabs);
    const text = documentDrafts[name] ?? data.documents[name] ?? '';
    const chunks = text.split(/(?=^## )/m);
    let intro = chunks.shift() || '';
    let chapters = chunks.map((chunk, index) => ({key: String(index), title: chunk.split('\n')[0].replace(/^## /, ''), text: chunk}));
    // In-text citations: every source ID becomes a numbered marker; 原始依据 becomes the numbered reference list.
    const citeOrder = [];
    for (const chapter of chapters) if (chapter.title !== '原始依据') for (const match of chapter.text.matchAll(/(?:SRC|META)-[0-9a-f]{24}/g)) if (!citeOrder.includes(match[0])) citeOrder.push(match[0]);
    const citeNumber = id => { if (!citeOrder.includes(id)) citeOrder.push(id); return citeOrder.indexOf(id) + 1; };
    if (!chapters.length) { intro = ''; chapters = [{key: '0', title: '正文', text}]; }
    documentChapter = Math.min(documentChapter, chapters.length - 1);
    const layout = element('div', null, 'selection-layout document-workspace');
    const toc = element('nav', null, 'selection-list doc-toc'); toc.setAttribute('aria-label', '文档章节');
    const reader = element('div', null, 'selection-detail');
    const card = element('article', null, 'panel requirement-card document-reader');
    const tools = element('header', null, 'document-reader-head');
    tools.append(element('h2', ({'prd.md': 'PRD', 'proposal.md': '项目方案'})[name]));
    const actions = element('div', null, 'document-actions');
    const edit = iconLabel(element('button', documentEditing ? '完成编辑' : '编辑本节', 'button small'), documentEditing ? 'decided' : 'edit');
    edit.type = 'button'; edit.disabled = documentSaving;
    edit.addEventListener('click', () => { documentEditing = !documentEditing; render(); document.getElementById('doc-sec-' + documentChapter)?.scrollIntoView?.({block: 'start'}); });
    const print = iconLabel(element('button', '打印 / PDF', 'button small'), 'print'); print.type = 'button';
    print.addEventListener('click', () => printDocument(name));
    const download = iconLabel(element('button', '下载正文', 'button small'), 'download'); download.type = 'button';
    download.addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([documentDrafts[name] ?? data.documents[name]], {type: 'text/markdown;charset=utf-8'}));
      const link = element('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    actions.append(edit, print, download);
    const save = iconLabel(element('button', '保存新版本', 'button primary small'), 'decided'); save.type = 'button';
    save.disabled = documentSaving || !Object.hasOwn(documentDrafts, name) || documentDrafts[name] === data.documents[name];
    if (serverState) {
      actions.append(save);
      save.addEventListener('click', async () => {
        const value = documentDrafts[name];
        const version = nextVersion();
        documentSaving = true; documentMessage = '正在保存…'; render();
        try {
          const result = await localRequest('/api/documents', {method: 'POST', body: JSON.stringify({document: name, content: value, version, base_sha256: data.artifacts.find(item => item.path === name)?.sha256})});
          location.assign('/versions/' + result.task.id + '/workbench/index.html?document=' + encodeURIComponent(name) + '#documents');
        } catch (error) { documentMessage = error.message; }
        finally { documentSaving = false; render(); }
      });
    }
    tools.append(actions); card.append(tools);
    if (documentMessage) { const message = element('p', documentMessage, 'inline-note'); message.setAttribute('role', 'status'); card.append(message); }
    const body = element('div', null, 'document-scroll');
    const tocButtons = [];
    chapters.forEach((chapter, index) => {
      const button = element('button', chapter.title); button.type = 'button';
      button.setAttribute('aria-current', String(index === documentChapter));
      button.addEventListener('click', () => {
        documentChapter = index;
        tocButtons.forEach((item, other) => item.setAttribute('aria-current', String(other === index)));
        if (documentEditing) { render(); }
        document.getElementById('doc-sec-' + index)?.scrollIntoView?.({behavior: 'smooth', block: 'start'});
      });
      tocButtons.push(button); toc.append(button);
      const section = element('section', null, 'doc-section'); section.id = 'doc-sec-' + index; section.dataset.index = String(index);
      const heading = chapter.text.startsWith('## ') ? chapter.text.split('\n')[0] : '';
      const chapterText = heading ? chapter.text.split('\n').slice(1).join('\n') : chapter.text;
      section.append(element('h2', chapter.title, 'doc-section-title'));
      if (documentEditing && index === documentChapter) {
        const editor = element('textarea', null, 'document-editor');
        editor.id = 'document-editor'; editor.setAttribute('aria-label', chapter.title + '正文');
        editor.rows = 16; editor.value = chapterText.trim(); editor.disabled = documentSaving;
        editor.addEventListener('input', () => {
          const revised = chapters.map((item, other) => other === index ? (heading ? heading + '\n\n' : '') + editor.value + '\n\n' : item.text);
          documentDrafts[name] = intro + revised.join('');
          save.disabled = documentSaving || documentDrafts[name] === data.documents[name];
        });
        section.append(editor);
      } else if (chapter.title === '原始依据') section.append(referenceList(citeOrder));
      else section.append(withCitations(markdownDocument(chapterText.replace(/(来源\s*—)\s*-?\s*((?:SRC|META)-[0-9a-f]{24})((?:\s*\n\s*-\s*(?:SRC|META)-[0-9a-f]{24})*)/g, (all, label, first, rest) => label + ' ' + [first, ...(rest.match(/(?:SRC|META)-[0-9a-f]{24}/g) || [])].join('、'))), citeNumber));
      body.append(section);
    });
    card.append(body);
    reader.append(card);
    layout.append(toc, reader);
    content.append(layout);
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => {
        if (documentEditing) return;
        const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (!visible) return;
        documentChapter = Number(visible.target.dataset.index);
        tocButtons.forEach((item, index) => item.setAttribute('aria-current', String(index === documentChapter)));
      }, {rootMargin: '0px 0px -70% 0px'});
      body.querySelectorAll('.doc-section').forEach(section => observer.observe(section));
    }
  }
  function artifactPreviews(prefix, emptyMessage) {
    let files = data.artifacts.filter(item => item.path.startsWith(prefix) && item.path.endsWith('.html'));
    if (prefix === 'diagrams/') files = files.filter(item => !item.path.endsWith('/modules.html')).slice(0, 1);
    if (!files.length) { content.append(empty(emptyMessage)); return; }
    for (const artifact of files) {
      const card = panel(prefix === 'data-model/' ? '业务数据模型' : prefix === 'prototype/' ? '交互原型' : '流程架构');
      card.append(fileLink(artifact.path, '打开完整页面'));
      const frame = element('iframe', null, 'workbench-preview');
      frame.title = artifact.path;
      if (prefix === 'data-model/') {
        frame.classList.add('data-model-preview');
        const resize = event => {
          if (!frame.isConnected) { window.removeEventListener('message', resize); return; }
          if (event.source !== frame.contentWindow || event.data?.type !== 'schema-canvas:size' || !Number.isFinite(event.data.height)) return;
          frame.style.height = Math.max(320, Math.min(1800, event.data.height)) + 'px';
        };
        window.addEventListener('message', resize);
      }
      frame.setAttribute('sandbox', 'allow-scripts allow-forms');
      frame.src = '../' + artifact.path.split('/').map(encodeURIComponent).join('/') + (prefix === 'data-model/' ? '?embed=1' : '');
      if (prefix === 'prototype/') {
        const controls = element('div', null, 'document-actions');
        controls.setAttribute('role', 'group');
        controls.setAttribute('aria-label', '原型预览尺寸');
        for (const [key, label] of [['desktop', '桌面'], ['tablet', '平板'], ['mobile', '手机']]) {
          const button = element('button', label, 'button small');
          button.type = 'button';
          button.setAttribute('aria-pressed', String(key === previewDevice));
          button.addEventListener('click', () => {
            previewDevice = key;
            frame.style.width = {desktop: '100%', tablet: '768px', mobile: '390px'}[key];
            for (const item of controls.querySelectorAll('button')) item.setAttribute('aria-pressed', String(item === button));
          });
          controls.append(button);
        }
        frame.style.width = {desktop: '100%', tablet: '768px', mobile: '390px'}[previewDevice];
        const pages = element('div', null, 'preview-pages');
        pages.setAttribute('role', 'group'); pages.setAttribute('aria-label', '原型页面');
        project.pages.forEach((page, index) => {
          const button = element('button', page.name || page.page_id, 'button small'); button.type = 'button';
          button.setAttribute('aria-pressed', String(index === 0));
          button.addEventListener('click', () => {
            frame.src = '../' + artifact.path.split('/').map(encodeURIComponent).join('/') + '#' + encodeURIComponent(page.page_id);
            pages.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
          });
          pages.append(button);
        });
        card.append(pages, controls);
      }
      card.append(frame);
      content.append(card);
    }
  }
  const nfrCategories = {performance: '性能与数据量', security: '权限与安全', compatibility: '兼容与设备', reliability: '可靠性与失败处理', usability: '易用性', accessibility: '无障碍', compliance: '审计与合规', other: '其他'};
  function nfrTitle(key) { return (project.nfrs || []).find(item => item.nfr_id === key)?.title; }
  let selectedPrototypePage = null;
  let prototypeAnnotate = false;
  // Page-by-page review of the prototype, recorded as release-stage verdicts on "prototype/index.html#<page_id>".
  let prototypeCommentPage = null;
  let prototypeReviewBusy = false;
  let prototypeReviewMessage = '';
  // The page itself cannot design a prototype: the Skill in the host (Claude Code, 码道…) designs pages from confirmed
  // FR/NFR, and the generator refuses unconfirmed input. So this page lists the hard prerequisites and hands a
  // ready-to-paste instruction to the Skill, like 交给开发 does for coding agents.
  let prototypeHandoffMessage = '';
  function prototypeChecklist() {
    const nfrs = project.nfrs || [];
    // Progress counts what the reviewer has already decided here, including verdicts and edits saved but not yet
    // applied (待生效): a row is ticked as soon as the work is done; the notice above says to generate the new version.
    const effective = item => statusView(item).status;
    const active = requirements.filter(req => effective(req) !== 'parked' && req.lifecycle_status !== 'cancelled');
    const confirmed = active.filter(req => effective(req) === 'confirmed');
    const pendingConfirm = confirmed.filter(req => req.review_status !== 'confirmed').length;
    const editedAcceptance = new Set(pendingChanges.filter(change => change.field === 'acceptance_criteria' && display(change.value) !== '待确认').map(change => change.target));
    const noAcceptance = confirmed.filter(req => display(req.acceptance_criteria) === '待确认' && !editedAcceptance.has(req.requirement_id));
    const openNfrs = nfrs.filter(item => !['confirmed', 'parked'].includes(effective(item)));
    const pendingNfr = nfrs.filter(item => statusView(item).pending).length;
    const pendingAll = (serverState?.review?.decisions || []).filter(item => (item.review_stage || 'definition') === 'definition').length + pendingChanges.length;
    const openFirst = target => () => { selectedRequirement = target; moduleView = 'list'; requirementTab = 'detail'; navigate('modules'); };
    const unconfirmed = active.find(req => effective(req) !== 'confirmed');
    // Acceptance criteria and NFRs are drafted by the Skill (it reads the meeting); the page hands over the instruction.
    const intro = '用「产品需求落地」Skill 处理项目《' + (project.name || project.project_id) + '》（版本 ' + project.artifact_version + '）：';
    const copyPrompt = (prompt, what) => async () => {
      try { await navigator.clipboard.writeText(intro + prompt); prototypeHandoffMessage = '已复制' + what + '的指令，粘贴到 Claude Code、码道等装了这个 Skill 的工具里；生成新版本后回到工作台确认'; } catch { prototypeHandoffMessage = '浏览器未允许复制'; }
      render();
    };
    const copyNfrPrompt = copyPrompt('从会议原话整理非功能需求（性能与数据量、权限与安全、兼容与设备、可靠性、审计等），按 references/prototype.md 写入 nfrs，标为草稿并保留原话依据，生成新版本后停下，等我在工作台确认。', '整理非功能需求');
    const rows = [
      {done: active.length > 0 && !unconfirmed, title: '确认功能需求', detail: active.length ? confirmed.length + ' / ' + active.length + ' 条已确认' + (pendingConfirm ? '，' + pendingConfirm + ' 条待生效' : '') : '还没有功能需求', go: unconfirmed && openFirst(unconfirmed.requirement_id), label: '去确认'},
      {done: confirmed.length > 0 && !noAcceptance.length, title: '补全验收标准', detail: !confirmed.length ? '确认需求后检查' : noAcceptance.length ? '缺 ' + noAcceptance.length + ' 条，让 Skill 起草后回到需求下核对' : '已确认的需求都有验收标准', go: noAcceptance.length && copyPrompt('为这些需求起草验收标准：' + noAcceptance.map(req => req.requirement_id + ' ' + req.title).join('、') + '。按 references/workflow.md 写成可检查的条目，覆盖正常路径和空数据、无权限、失败情况，写入各需求的 acceptance_criteria，生成新版本后停下，等我在工作台核对。', '起草验收标准'), label: '复制起草指令'},
      {done: nfrs.length > 0 && !openNfrs.length, title: '确认非功能需求', detail: !nfrs.length ? '还没有，让 Skill 从会议里整理成草稿' : openNfrs.length ? openNfrs.length + ' 条待确认，在「功能需求」最下面一组' : nfrs.length + ' 条已处理' + (pendingNfr ? '，' + pendingNfr + ' 条待生效' : ''), go: openNfrs[0] ? openFirst(openNfrs[0].nfr_id) : !nfrs.length && copyNfrPrompt, label: nfrs.length ? '去确认' : '复制整理指令'},
    ];
    const missing = rows.filter(row => !row.done);
    const card = panel('生成原型');
    if (pendingAll) {
      const notice = element('div', null, 'review-pending-bar');
      notice.append(element('span', pendingAll + ' 条结论待生效，生成新版本后才算数'));
      const go = element('button', '去生成新版本', 'button primary small'); go.type = 'button'; go.addEventListener('click', () => { moduleView = 'list'; navigate('modules'); });
      notice.append(go); card.append(notice);
    }
    card.append(element('p', missing.length ? '生成前完成这 ' + rows.length + ' 项，原型只按已确认的需求生成。' : '都完成了，复制下面的指令交给 Skill 生成原型。', 'inline-note'));
    const list = element('ol', null, 'prototype-checklist');
    for (const row of rows) {
      const item = element('li', null, row.done ? 'done' : '');
      const body = element('div');
      body.append(element('strong', row.title), element('span', row.detail));
      item.append(element('span', row.done ? '✓' : '', 'check-mark'), body);
      if (row.go && !row.done) { const go = element('button', row.label || '去处理', 'button ghost small'); go.type = 'button'; go.addEventListener('click', row.go); item.append(go); }
      list.append(item);
    }
    card.append(list);
    const lines = [
      '用「产品需求落地」Skill 为项目《' + (project.name || project.project_id) + '》生成可交互原型。',
      '项目编号：' + project.project_id + '；基于版本：' + project.artifact_version + '。',
      '按 references/prototype.md：确定项目定位、信息架构和页面，把已确认的功能需求落到页面，写入 prototype_design，检查覆盖后生成原型，并生成新版本。',
    ];
    if (missing.length || pendingAll) lines.push('上面还有没完成的项时先停下，告诉我还差什么。');
    const text = lines.join('\n');
    const handoff = element('section', null, 'handoff-preview prototype-handoff'); handoff.setAttribute('aria-label', '交给 Skill 生成原型');
    const head = element('div', null, 'handoff-head');
    head.append(iconLabel(element('strong', '交给 Skill 生成原型'), 'prototype'));
    const copy = iconLabel(element('button', '复制指令', missing.length ? 'button small' : 'button primary small'), 'copy'); copy.type = 'button';
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); prototypeHandoffMessage = '已复制，粘贴到 Claude Code、码道等装了这个 Skill 的工具里'; } catch { prototypeHandoffMessage = '浏览器未允许复制，请手动选中下面的文字'; }
      render();
    });
    head.append(copy); handoff.append(head);
    if (prototypeHandoffMessage) { const status = element('p', prototypeHandoffMessage, 'inline-note'); status.setAttribute('role', 'status'); handoff.append(status); }
    handoff.append(element('pre', text, 'handoff-text'));
    card.append(handoff);
    content.append(card);
  }
  function designedPrototype(artifact) {
    const design = project.prototype_design;
    const pages = design.pages;
    const nfrs = project.nfrs || [];
    if (!pages.some(page => page.page_id === selectedPrototypePage)) selectedPrototypePage = design.start_page_id || pages[0].page_id;
    const devices = design.positioning?.target_devices?.length ? design.positioning.target_devices : ['desktop'];
    if (!devices.includes(previewDevice)) previewDevice = devices[0];
    const widths = {desktop: '100%', tablet: '768px', mobile: '390px'};
    const covered = new Set(pages.flatMap(page => page.requirement_ids || []));
    const confirmedNfrs = nfrs.filter(item => item.review_status === 'confirmed');
    const shown = confirmedNfrs.filter(item => item.prototype_treatment?.kind === 'shown').length;
    const toolbar = element('div', null, 'prototype-toolbar');
    toolbar.append(iconLabel(element('span', [artifact.artifact_version || project.artifact_version, '覆盖 ' + covered.size + ' 条需求', confirmedNfrs.length ? '体现 ' + shown + ' 条非功能需求' : ''].filter(Boolean).join(' · '), 'prototype-summary'), 'prototype'));
    const tools = element('div', null, 'document-actions');
    const frame = element('iframe', null, 'workbench-preview prototype-frame');
    frame.title = '交互原型';
    frame.setAttribute('sandbox', 'allow-scripts allow-forms');
    // The prototype HTML travels inside the workbench and loads through srcdoc, so it shows wherever the workbench
    // does (file://, shared copies, sandboxed previews). Older workbenches without it still load the sibling file.
    if (data.prototype_html) {
      const initial = selectedPrototypePage;
      const boot = 'document.documentElement.dataset.startPage=' + JSON.stringify(initial).replace(/</g, '\\u003c') + ';' + (prototypeAnnotate ? "document.documentElement.dataset.annotate='';" : '');
      frame.srcdoc = data.prototype_html.replace('</head>', '<scr' + 'ipt>' + boot + '</scr' + 'ipt></head>');
      frame.addEventListener('load', () => frame.contentWindow?.postMessage({type: 'prototype:go', page_id: initial}, '*'), {once: true});
    } else {
      const base = '../' + artifact.path.split('/').map(encodeURIComponent).join('/');
      frame.src = base + (prototypeAnnotate ? '?annotate=1' : '') + '#' + encodeURIComponent(selectedPrototypePage);
    }
    frame.style.width = widths[previewDevice];
    if (devices.length > 1) for (const device of devices) {
      const button = iconLabel(element('button', {desktop: '桌面', tablet: '平板', mobile: '手机'}[device], 'button ghost small'), device === 'desktop' ? 'prototype' : 'mobile'); button.type = 'button';
      button.setAttribute('aria-pressed', String(device === previewDevice));
      button.addEventListener('click', () => { previewDevice = device; frame.style.width = widths[device]; tools.querySelectorAll('[data-device]').forEach(item => item.setAttribute('aria-pressed', String(item === button))); });
      button.dataset.device = device; tools.append(button);
    }
    const annotate = iconLabel(element('button', '标注需求', 'button ghost small'), 'modules'); annotate.type = 'button';
    annotate.setAttribute('aria-pressed', String(prototypeAnnotate));
    annotate.addEventListener('click', () => { prototypeAnnotate = !prototypeAnnotate; annotate.setAttribute('aria-pressed', String(prototypeAnnotate)); frame.contentWindow?.postMessage({type: 'prototype:annotate', on: prototypeAnnotate}, '*'); });
    tools.append(annotate, fileLink(artifact.path, '独立打开'));
    toolbar.append(tools);
    content.append(toolbar);
    const fileTarget = artifact.path;
    const pageTarget = id => fileTarget + '#' + id;
    function verdicts() {
      const latest = new Map();
      for (const item of serverState?.review?.decisions || []) if (item.review_stage === 'release') latest.set(item.target, item);
      return latest;
    }
    // Pages are fine unless someone says otherwise: only change requests are recorded per page, and one
    // confirmation of the whole prototype releases it to the customer.
    const pageComment = (latest, page) => { const item = latest.get(pageTarget(page.page_id)); return item?.outcome === 'needs_changes' ? item : null; };
    const reviewBar = element('section', null, 'prototype-review-bar'); reviewBar.setAttribute('aria-label', '原型评审');
    if (serverState) content.append(reviewBar);
    function drawReviewBar() {
      if (!serverState) return;
      const latest = verdicts();
      const changes = pages.filter(page => pageComment(latest, page));
      const released = latest.get(fileTarget)?.outcome === 'confirmed';
      const releases = (serverState.releases || []).filter(item => item.artifact_version === project.artifact_version);
      reviewBar.replaceChildren();
      const summary = element('div', null, 'prototype-review-progress');
      if (changes.length) summary.append(element('strong', changes.length + ' 页有修改意见'), element('span', '复制指令交给 Skill 修改，生成新版本后再看', 'prototype-review-note'));
      else if (releases.length) summary.append(element('strong', '交付包已生成'), element('span', '可以预览或下载发给客户', 'prototype-review-note'));
      else summary.append(element('strong', '没有修改意见'), element('span', '看完原型没问题，就可以生成交付包；哪页要改，点原型上方的「这页要改」', 'prototype-review-note'));
      reviewBar.append(summary);
      const actions = element('div', null, 'document-actions');
      if (changes.length) {
        const lines = ['用「产品需求落地」Skill 修改项目《' + (project.name || project.project_id) + '》的原型（版本 ' + project.artifact_version + '）。', '修改意见：'];
        changes.forEach(page => lines.push('- ' + page.name + '（' + page.page_id + '）：' + pageComment(latest, page).comment));
        lines.push('按 references/prototype.md 只改这些页面，意见涉及需求变化时先改需求卡并告诉我；生成新版本后停下，等我在工作台复核。');
        const copy = iconLabel(element('button', '复制修改指令', 'button primary small'), 'copy'); copy.type = 'button';
        copy.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(lines.join('\n')); prototypeReviewMessage = '已复制，粘贴到 Claude Code、码道等装了这个 Skill 的工具里'; } catch { prototypeReviewMessage = '浏览器未允许复制'; }
          drawReviewBar();
        });
        actions.append(copy);
      } else if (!releases.length) {
        const build = iconLabel(element('button', '确认并生成交付包', 'button primary small'), 'package'); build.type = 'button';
        build.disabled = workflowBusy;
        build.addEventListener('click', () => workflowAction(async () => {
          if (!released) {
            const result = await localRequest('/api/review', {method: 'POST', body: JSON.stringify({revision: serverState.review.revision, review_stage: 'release', target: fileTarget, outcome: 'confirmed', comment: '', reviewer: ''})});
            serverState.review = result.review;
          }
          return localRequest('/api/release', {method: 'POST', body: JSON.stringify({files: [fileTarget], revision: serverState.review.revision})});
        }));
        actions.append(build);
      } else {
        const release = releases[releases.length - 1];
        const preview = iconLabel(element('a', '预览交付包', 'button small'), 'external'); preview.href = '/customer/' + release.release_id + '/index.html'; preview.target = '_blank'; preview.rel = 'noopener';
        const download = iconLabel(element('a', '下载 ZIP', 'button small'), 'download'); download.href = '/api/releases/' + release.release_id + '/package'; download.download = project.project_id + '-' + release.artifact_version + '.zip';
        actions.append(preview, download);
      }
      reviewBar.append(actions);
      const message = prototypeReviewMessage || (workflowMessage && !workflowBusy && !releases.length ? workflowMessage : '');
      if (message) { const status = element('p', message, 'inline-note prototype-review-message'); status.setAttribute('role', 'status'); reviewBar.append(status); }
    }
    const layout = element('div', null, 'prototype-layout');
    const list = element('nav', null, 'selection-list'); list.setAttribute('aria-label', '原型页面');
    const side = element('div', null, 'prototype-stage');
    const mapping = element('section', null, 'panel prototype-mapping'); mapping.setAttribute('aria-label', '当前页说明');
    const pageBar = element('div', null, 'prototype-page-bar');
    function drawMapping() {
      const page = pages.find(item => item.page_id === selectedPrototypePage);
      list.querySelectorAll('[data-selection-key]').forEach(node => { if (node.dataset.selectionKey === page.page_id) node.setAttribute('aria-current', 'true'); else node.removeAttribute('aria-current'); });
      pageBar.replaceChildren(pageReview(page));
      // One card per page: what it is for, then label/value rows that only appear when the page has them.
      const head = element('header', null, 'page-spec-head');
      head.append(element('span', '当前页', 'page-spec-eyebrow'), element('h2', page.name), element('p', page.purpose, 'prototype-purpose'));
      const spec = element('dl', null, 'page-spec');
      const row = (label, body) => { const value = element('dd'); value.append(body); spec.append(element('dt', label), value); };
      const reqs = (page.requirement_ids || []).map(id => requirements.find(req => req.requirement_id === id)).filter(Boolean);
      if (reqs.length) {
        const rows = element('ul', null, 'prototype-links');
        reqs.forEach(req => { const item = element('li'); item.append(element('span', req.requirement_id, 'req-id'), requirementLink(req)); rows.append(item); });
        row('功能需求', rows);
      }
      const pageNfrs = (page.nfr_ids || []).map(id => nfrs.find(item => item.nfr_id === id)).filter(Boolean);
      if (pageNfrs.length) row('非功能需求', specItems(pageNfrs.map(item => [item.title, nfrCategories[item.category] || item.category, item.prototype_treatment?.note || item.statement])));
      const stateNames = {empty: '空数据', loading: '加载中', error: '出错', denied: '无权限', success: '成功'};
      const roleNames = Object.fromEntries((design.roles || []).map(role => [role.role_id, role.name]));
      if (page.states?.length) row('可演示状态', chips(page.states.map(state => stateNames[state] || state)));
      if (page.roles?.length) row('可见角色', chips(page.roles.map(role => roleNames[role] || role)));
      mapping.replaceChildren(head);
      if (spec.children.length) mapping.append(spec);
    }
    function chips(names) { const list = element('ul', null, 'spec-chips'); names.forEach(name => list.append(element('li', name))); return list; }
    // Requirement-like entries: title and category tag on one line, the note underneath.
    function specItems(items) {
      const list = element('ul', null, 'spec-items');
      items.forEach(([title, tag, note]) => { const item = element('li'); const line = element('div', null, 'spec-item-title'); line.append(element('strong', title), element('span', tag, 'nfr-category')); item.append(line); if (note) item.append(element('p', note)); list.append(item); });
      return list;
    }
    function openPage(id) { selectedPrototypePage = id; frame.contentWindow?.postMessage({type: 'prototype:go', page_id: id}, '*'); drawMapping(); }
    function drawPages() {
      const latest = verdicts();
      list.replaceChildren();
      for (const page of pages) {
        const button = element('button', null, 'selection-button prototype-page-chip'); button.type = 'button'; button.dataset.selectionKey = page.page_id;
        const comment = pageComment(latest, page);
        button.append(element('strong', page.name));
        // Only pages with a change request are marked; the chip otherwise just names the page.
        if (comment) { button.dataset.verdict = 'needs_changes'; const mark = element('span', '要改', 'page-change-mark'); button.append(mark); button.setAttribute('aria-label', page.name + '：有修改意见'); }
        button.addEventListener('click', () => openPage(page.page_id));
        list.append(button);
      }
    }
    async function savePageComment(page, outcome, comment) {
      prototypeReviewBusy = true; prototypeReviewMessage = ''; drawMapping();
      try {
        const result = await localRequest('/api/review', {method: 'POST', body: JSON.stringify({revision: serverState.review.revision, review_stage: 'release', target: pageTarget(page.page_id), outcome, comment, reviewer: ''})});
        serverState.review = result.review; prototypeCommentPage = null;
      } catch (error) {
        prototypeReviewMessage = error.message;
        try { await refreshLocal(); } catch { /* keep the first error */ }
      } finally { prototypeReviewBusy = false; }
      drawPages(); drawReviewBar(); drawMapping();
    }
    // One row above the preview, on every screen width: the page name and, if any, its change request.
    function pageReview(page) {
      const box = element('section', null, 'page-review'); box.setAttribute('aria-label', '这一页的修改意见');
      const comment = pageComment(verdicts(), page);
      if (comment) box.dataset.verdict = 'needs_changes';
      const head = element('div', null, 'page-review-head');
      head.append(element('strong', page.name, 'page-review-name'));
      box.append(head);
      if (!serverState) return box;
      if (prototypeCommentPage === page.page_id) {
        const label = element('label', '这一页要改什么', 'page-review-label');
        const note = element('textarea', null, 'page-review-input'); note.rows = 2; note.value = comment?.comment || '';
        note.placeholder = '比如：列表缺少按状态筛选；提交后应回到详情页'; label.append(note);
        const actions = element('div', null, 'document-actions page-review-actions');
        const save = element('button', '保存意见', 'button primary small'); save.type = 'button'; save.disabled = prototypeReviewBusy;
        save.addEventListener('click', () => { if (!note.value.trim()) { note.focus(); return; } savePageComment(page, 'needs_changes', note.value.trim()); });
        const cancel = element('button', '取消', 'button ghost small'); cancel.type = 'button';
        cancel.addEventListener('click', () => { prototypeCommentPage = null; drawMapping(); });
        actions.append(save, cancel); box.append(label, actions);
        setTimeout(() => note.focus());
        return box;
      }
      const actions = element('div', null, 'document-actions page-review-actions');
      const edit = element('button', comment ? '改意见' : '这页要改', 'button small'); edit.type = 'button'; edit.disabled = prototypeReviewBusy;
      edit.addEventListener('click', () => { prototypeCommentPage = page.page_id; drawMapping(); });
      actions.append(edit);
      if (comment) {
        head.append(element('span', '有修改意见', 'page-review-status'));
        const withdraw = element('button', '撤回', 'button ghost small'); withdraw.type = 'button'; withdraw.disabled = prototypeReviewBusy;
        withdraw.addEventListener('click', () => savePageComment(page, 'confirmed', '撤回修改意见'));
        actions.append(withdraw);
      }
      head.append(actions);
      if (comment) box.append(element('p', comment.comment, 'page-review-comment'));
      return box;
    }
    drawPages();
    const listener = event => {
      if (!frame.isConnected) { window.removeEventListener('message', listener); return; }
      if (event.source !== frame.contentWindow || event.data?.type !== 'prototype:page' || !pages.some(page => page.page_id === event.data.page_id)) return;
      if (selectedPrototypePage !== event.data.page_id) { selectedPrototypePage = event.data.page_id; drawMapping(); }
    };
    window.addEventListener('message', listener);
    // Phone and tablet previews get a device-sized viewport instead of a strip of the desktop canvas.
    const applyDevice = () => { frame.dataset.device = previewDevice; frame.style.width = widths[previewDevice]; };
    applyDevice();
    tools.querySelectorAll('[data-device]').forEach(button => button.addEventListener('click', applyDevice));
    side.append(pageBar, frame);
    layout.append(list, side, mapping);
    content.append(layout);
    drawMapping();
    drawReviewBar();
    // Rules that hold for the whole prototype, kept apart from the per-page card.
    const overall = (design.positioning?.nfr_ids || []).map(id => nfrs.find(item => item.nfr_id === id)).filter(Boolean);
    const excluded = design.excluded_requirements || [];
    const skipped = confirmedNfrs.filter(item => item.prototype_treatment?.kind === 'not_applicable');
    if (overall.length || excluded.length || skipped.length) {
      const card = panel('整个原型');
      card.classList.add('prototype-scope');
      const groups = element('div', null, 'prototype-scope-groups');
      if (overall.length) {
        const group = element('section', null, 'prototype-scope-group');
        group.append(element('h3', '每页都要满足'), element('p', '所有页面共同遵守，不在每页重复列出。', 'inline-note'), specItems(overall.map(item => [item.title, nfrCategories[item.category] || item.category, item.prototype_treatment?.note || item.statement])));
        groups.append(group);
      }
      if (excluded.length || skipped.length) {
        const group = element('section', null, 'prototype-scope-group');
        group.append(element('h3', '不在原型中'), element('p', '已确认，但不需要或没法在原型里演示，开发时照常实现。', 'inline-note'), specItems([
          ...excluded.map(item => [requirements.find(req => req.requirement_id === item.requirement_id)?.title || item.requirement_id, '功能需求', item.reason]),
          ...skipped.map(item => [item.title, nfrCategories[item.category] || item.category, item.prototype_treatment.note]),
        ]));
        groups.append(group);
      }
      card.append(groups); content.append(card);
    }
  }
  function prototype() {
    const artifact = data.artifacts.find(item => item.path === 'prototype/index.html');
    if (artifact && project.prototype_design?.pages?.length) { designedPrototype(artifact); return; }
    if (artifact) { artifactPreviews('prototype/', '暂无原型'); return; }
    prototypeChecklist();
  }
  // Entities and fields render directly in the page; the Schema Canvas ERD opens as its own page when generated.
  function diagramOpenIcon(path, label) {
    const open = element('a', null, 'diagram-open'); open.href = '../' + path; open.target = '_blank'; open.rel = 'noopener';
    open.setAttribute('aria-label', label); open.title = '独立打开'; open.append(icon('external'));
    return open;
  }
  // Fields of one business entity, shared by the Schema Canvas view and the plain fallback.
  function entityDetail(entity, links, entitiesById) {
    const key = entity.entity_id || entity.name;
    const detail = panel((entity.name || key) + ' 的字段', 'documents');
    detail.classList.add('entity-detail'); detail.dataset.entityId = key;
    if (entity.description) detail.append(element('p', entity.description, 'material-metadata'));
    if (Array.isArray(entity.fields) && entity.fields.length) {
      const scroll = element('div', null, 'data-table-scroll');
      const table = element('table', null, 'data-table');
      const head = table.createTHead().insertRow();
      for (const label of ['字段', '类型', '说明']) { const cell = element('th', label); cell.scope = 'col'; head.append(cell); }
      const body = table.createTBody();
      for (const field of entity.fields) {
        const row = body.insertRow();
        row.insertCell().textContent = field.name || field.field_id || '';
        row.insertCell().textContent = typeLabel(field.type);
        const {name, field_id, type, ...rest} = field;
        row.insertCell().textContent = field.description || field.note || (Object.keys(rest).length ? Object.entries(rest).map(([k, value]) => k + '：' + display(value)).join('；') : '—');
      }
      scroll.append(table); detail.append(scroll);
    } else detail.append(empty('实体字段待确认'));
    const nearby = links.filter(link => link.from === key || link.to === key);
    if (nearby.length) {
      const list = element('ul', null, 'entity-relations');
      for (const link of nearby) list.append(element('li', (entitiesById.get(link.from)?.name || link.from) + ' → ' + (entitiesById.get(link.to)?.name || link.to) + ' · ' + (link.cardinality || '关系待确认') + (link.label ? ' · ' + link.label : '')));
      detail.append(list);
    }
    const reqs = requirements.filter(req => entity.requirement_ids?.includes(req.requirement_id));
    if (reqs.length) { const used = element('p', '相关需求：', 'inline-note entity-reqs'); reqs.forEach(req => used.append(requirementLink(req))); detail.append(used); }
    return detail;
  }
  function database() {
    const model = project.business_model || {};
    const entities = Array.isArray(model.entities) ? model.entities : [];
    const identity = entity => entity.entity_id || entity.name;
    const entitiesById = new Map(entities.map(entity => [identity(entity), entity]));
    const links = Array.isArray(model.relations) ? model.relations.filter(link => entitiesById.has(link?.from) && entitiesById.has(link?.to)) : [];
    // Same pattern as the architecture: a compact diagram, the page search at top right filters it, and a table's
    // fields appear below only after it is clicked. The full Schema Canvas (with its own tools) opens from the corner icon.
    if (data.data_model_diagram) {
      const card = element('section', null, 'panel diagram-card'); card.setAttribute('aria-label', '数据模型');
      card.append(diagramOpenIcon('data-model/index.html', '在新页面打开数据模型'));
      const frame = element('iframe', null, 'architecture-preview data-model-frame'); frame.title = 'Schema Canvas 数据模型'; frame.setAttribute('sandbox', 'allow-scripts');
      const hint = element('p', '点选图中的表，查看字段和关系', 'inline-note diagram-hint');
      const slot = element('div', null, 'entity-detail-slot');
      function show(key) {
        const entity = entitiesById.get(key); if (!entity) return;
        selectedEntity = key; hint.remove();
        slot.replaceChildren(entityDetail(entity, links, entitiesById));
      }
      const bridge = `(() => {
        const style = document.createElement('style');
        style.textContent = 'html,body{margin:0}.top,.toolbar,.panel,.audit,footer{display:none !important}.shell{padding:0 !important;max-width:none !important}.workspace{display:block !important;margin:0 !important}.canvasWrap{height:auto !important;min-height:0 !important;overflow:auto}.canvas{zoom:.78}html:not([data-picked]) .tableNode.selected{border:1px solid #bfc9c5 !important;background:white !important}';
        document.head.append(style);
        const canvas = document.querySelector('.canvas');
        const report = () => parent.postMessage({type:'product-requirements:schema-size',height:Math.ceil(document.querySelector('.canvasWrap').getBoundingClientRect().height)},'*');
        new ResizeObserver(report).observe(document.querySelector('.canvasWrap')); report();
        document.addEventListener('click', event => { const node = event.target.closest('.tableNode'); if (!node) return; document.documentElement.dataset.picked = ''; parent.postMessage({type:'product-requirements:schema-select',id:node.dataset.id},'*'); }, true);
        window.addEventListener('message', event => {
          if (event.source !== parent) return;
          if (event.data?.type === 'product-requirements:schema-query') { const input = document.getElementById('search'); input.value = String(event.data.query || ''); input.dispatchEvent(new Event('input')); }
          if (event.data?.type === 'product-requirements:schema-state') { const node = [...document.querySelectorAll('.tableNode')].find(item => item.dataset.id === event.data.id); if (node) { document.documentElement.dataset.picked = ''; node.click(); } }
        });
      })();`;
      const listen = event => {
        if (!frame.isConnected) { window.removeEventListener('message', listen); return; }
        if (event.source !== frame.contentWindow) return;
        if (['product-requirements:schema-size', 'schema-canvas:size'].includes(event.data?.type) && Number.isFinite(event.data.height)) frame.style.height = Math.max(160, Math.min(900, event.data.height)) + 'px';
        if (event.data?.type === 'product-requirements:schema-select' && typeof event.data.id === 'string') show(event.data.id);
      };
      window.addEventListener('message', listen);
      frame.addEventListener('load', () => {
        if (queryInput.value) frame.contentWindow?.postMessage({type: 'product-requirements:schema-query', query: queryInput.value}, '*');
        if (selectedEntity && entitiesById.has(selectedEntity)) frame.contentWindow?.postMessage({type: 'product-requirements:schema-state', id: selectedEntity}, '*');
      });
      frame.srcdoc = data.data_model_diagram.replace('</head>', '<scr' + 'ipt>document.documentElement.dataset.embedded="true";</scr' + 'ipt></head>').replace('</body>', '<scr' + 'ipt>' + bridge + '</scr' + 'ipt></body>');
      card.append(frame); content.append(card, hint, slot);
      if (selectedEntity && entitiesById.has(selectedEntity)) show(selectedEntity);
      return;
    }
    if (!entities.length) { content.append(empty('业务数据模型待整理')); return; }
    const current = entitiesById.get(selectedEntity) || entities[0];
    selectedEntity = identity(current);
    // Fallback without Schema Canvas: entity cards on top, the selected entity's fields below.
    const map = panel('业务实体', 'database');
    map.classList.add('entity-map');
    const grid = element('div', null, 'entity-cards'); grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', '选择业务实体');
    for (const entity of entities.filter(matches)) {
      const key = identity(entity);
      const related = links.filter(link => link.from === key || link.to === key).length;
      const card = element('button', null, 'entity-card'); card.type = 'button';
      card.setAttribute('aria-pressed', String(entity === current));
      card.append(element('strong', entity.name || key), element('span', (entity.fields?.length || 0) + ' 个字段 · ' + related + ' 个关系'));
      card.addEventListener('click', () => { selectedEntity = key; render(); content.querySelector('.entity-card[aria-pressed="true"]')?.focus(); });
      grid.append(card);
    }
    map.append(grid);
    content.append(map, entityDetail(current, links, entitiesById));
  }
  // ParTrace-style API table: header row, one group per business module, one row per endpoint; click a row for request / response / errors.
  function apiModule(item) {
    const modules = project.modules || [];
    return modules.find(module => module.module_id === item.module_id) || modules.find(module => (module.requirement_ids || []).some(id => item.requirement_ids?.includes(id)));
  }
  const typeLabels = {string: '文本', text: '长文本', varchar: '文本', char: '文本', int: '整数', integer: '整数', bigint: '整数', number: '数字', float: '小数', double: '小数', decimal: '小数', boolean: '布尔', bool: '布尔', date: '日期', datetime: '日期时间', timestamp: '时间戳', time: '时间', json: 'JSON', object: '对象', array: '列表', list: '列表', enum: '枚举', uuid: 'UUID', file: '文件', url: '链接'};
  function typeLabel(value) { return value ? typeLabels[String(value).trim().toLowerCase()] || value : '待确认'; }
  function api() {
    const apis = (project.apis || []).filter(matches);
    if (!apis.length) { content.append(empty('暂无接口设计：本次分析没有整理接口草案。需要时让 Skill 按已确认需求补充 apis，并标为草案')); return; }
    const list = element('section', null, 'panel api-list'); list.setAttribute('aria-label', '接口列表');
    const head = element('div', null, 'api-head');
    for (const label of ['方法', '路径', '用途', '状态']) head.append(element('span', label));
    list.append(head);
    const groups = new Map();
    for (const item of apis) { const module = apiModule(item); const key = module?.module_id || ''; if (!groups.has(key)) groups.set(key, {module, items: []}); groups.get(key).items.push(item); }
    const modules = project.modules || [];
    const ordered = [...groups.values()].sort((a, b) => (a.module ? modules.indexOf(a.module) : 1e9) - (b.module ? modules.indexOf(b.module) : 1e9));
    ordered.forEach((group, index) => {
      const title = element('div', null, 'api-group');
      title.append(element('strong', (index + 1) + '. ' + (group.module?.name || '未归属模块')), element('span', group.items.length + ' 个接口'));
      list.append(title);
      for (const item of group.items) {
        const row = element('details', null, 'api-row');
        const summary = element('summary');
        const method = element('span', String(item.method || '—').toUpperCase(), 'api-method'); method.dataset.method = String(item.method || '').toUpperCase();
        summary.append(method, element('code', display(item.path), 'api-path'), element('span', item.name || item.api_id, 'api-name'), element('span', states[item.review_status] || item.review_status || '草稿', 'api-status'));
        row.append(summary);
        const body = element('div', null, 'api-body');
        for (const [caption, value] of [['请求', item.request], ['响应', item.response], ['异常', item.errors]]) {
          if (value === undefined || value === null || (Array.isArray(value) && !value.length)) continue;
          const block = element('section', null, 'api-block'); block.append(element('h3', caption));
          block.append(element('pre', typeof value === 'string' ? value : JSON.stringify(value, null, 2), 'api-code'));
          body.append(block);
        }
        const related = requirements.filter(req => item.requirement_ids?.includes(req.requirement_id));
        if (related.length) { const links = element('p', '关联需求：', 'inline-note api-related'); related.forEach(req => links.append(requirementLink(req))); body.append(links); }
        row.append(body); list.append(row);
      }
    });
    content.append(list);
  }
  // Delivery = send the confirmed prototype to the customer: confirm this version, then build the package.
  function releasePanel() {
    const card = panel('发给客户', 'package');
    const files = data.artifacts.filter(item => item.path.startsWith('prototype/') && item.path.endsWith('.html'));
    if (!files.length) {
      card.append(element('p', '这里用来把确认过的原型打包发给客户。当前版本还没有原型：需求确认后先在“原型预览”生成原型。', 'inline-note'));
      content.append(card); return;
    }
    if (!serverState) { card.append(element('p', '当前为只读分享版，打包请在本机工作台中进行。', 'inline-note')); content.append(card); return; }
    const confirmed = new Set((serverState.review.decisions || []).filter(item => item.review_stage === 'release' && item.outcome === 'confirmed').map(item => item.target));
    const allConfirmed = files.every(file => confirmed.has(file.path));
    card.append(element('p', '1. 打开原型核对一遍，确认这一版可以给客户看；2. 生成交付包，可预览或下载 ZIP 发给客户。', 'inline-note'));
    const steps = element('div', null, 'document-actions delivery-steps');
    const confirm = iconLabel(element('button', allConfirmed ? '已确认可对外' : '确认可以给客户看', 'button small'), 'decided'); confirm.type = 'button';
    confirm.disabled = allConfirmed || workflowBusy;
    confirm.addEventListener('click', () => workflowAction(async () => {
      for (const file of files) if (!confirmed.has(file.path)) {
        const result = await localRequest('/api/review', {method: 'POST', body: JSON.stringify({revision: serverState.review.revision, review_stage: 'release', target: file.path, outcome: 'confirmed', comment: '', reviewer: ''})});
        serverState.review = result.review;
      }
      return {message: '已确认，可以生成交付包'};
    }));
    const build = iconLabel(element('button', '生成交付包', 'button primary small'), 'package'); build.type = 'button';
    build.disabled = !allConfirmed || workflowBusy;
    build.addEventListener('click', () => workflowAction(() => localRequest('/api/release', {method: 'POST', body: JSON.stringify({files: files.map(file => file.path), revision: serverState.review.revision})})));
    steps.append(fileLink(files[0].path, '打开原型'), confirm, build);
    card.append(steps);
    if (workflowMessage) card.append(element('p', workflowMessage, 'inline-note'));
    for (const release of serverState.releases || []) {
      const row = element('div', null, 'intake-row');
      const info = element('div', null, 'intake-row-info'); info.append(element('strong', release.artifact_version + ' 交付包'), element('span', '只含原型，不含内部资料'));
      const actions = element('div', null, 'intake-row-actions');
      const preview = iconLabel(element('a', '预览', 'button small'), 'external'); preview.href = '/customer/' + release.release_id + '/index.html'; preview.target = '_blank'; preview.rel = 'noopener';
      const download = iconLabel(element('a', '下载 ZIP', 'button small'), 'download'); download.href = '/api/releases/' + release.release_id + '/package'; download.download = project.project_id + '-' + release.artifact_version + '.zip';
      actions.append(preview, download); row.append(info, actions); card.append(row);
    }
    content.append(card);
  }
  function customerReview() {
    const card = panel('客户复核', 'actors');
    content.append(card);
    if (!serverState) {
      card.append(element('p', '请在本地工作台中创建问卷和查看回答。', 'inline-note'));
      return;
    }
    const feedback = serverState.jobs.filter(job => job.provenance?.provider === 'customer_review' && job.provenance.artifact_version === project.artifact_version);
    const responses = panel('本版客户反馈', 'review');
    const refresh = iconLabel(element('button', '刷新反馈', 'button ghost small'), 'refresh');
    refresh.type = 'button';
    const feedbackStatus = element('p', '', 'inline-note');
    feedbackStatus.setAttribute('role', 'status');
    const list = element('ul');
    function showFeedback(jobs) {
      list.replaceChildren();
      for (const job of jobs.filter(item => item.status !== 'failed')) {
        const row = element('li');
        row.append(jobLink(job, 'original', '查看反馈 ' + job.job_id.slice(-8)));
        list.append(row);
      }
      feedbackStatus.textContent = list.childElementCount ? '' : '本版暂无已接收的反馈';
    }
    showFeedback(feedback);
    refresh.addEventListener('click', async () => {
      try {
        await refreshLocal();
        showFeedback(serverState.jobs.filter(job => job.provenance?.provider === 'customer_review' && job.provenance.artifact_version === project.artifact_version));
      } catch (error) { feedbackStatus.textContent = error.message; }
    });
    responses.append(refresh, feedbackStatus, list);
    content.append(responses);
    if (!serverState.customer_review_enabled) {
      card.append(element('p', '启动工作台时传入 --customer-host 本机局域网 IP，即可生成客户答题链接。', 'inline-note'));
      return;
    }
    if (!requirements.length) {
      card.append(element('p', '先整理至少一条需求，再创建客户问卷。', 'inline-note'));
      return;
    }
    const form = element('form', null, 'intake-form customer-question-form');
    const questions = element('div', null, 'customer-question-list');
    const add = iconLabel(element('button', '添加问题', 'button'), 'plus');
    add.type = 'button';
    const publish = iconLabel(element('button', '生成答题链接', 'button primary'), 'link');
    publish.type = 'submit';
    const status = element('p', '', 'inline-note');
    status.setAttribute('role', 'status');
    function updateActions() {
      add.disabled = questions.childElementCount >= 20;
      publish.disabled = !questions.childElementCount;
    }
    function addQuestion() {
      const row = element('fieldset', null, 'customer-question');
      const target = element('select');
      for (const requirement of requirements) {
        const option = element('option', requirement.title);
        option.value = requirement.requirement_id;
        target.append(option);
      }
      if (reviewTarget) target.value = requirements.some(req => req.requirement_id === reviewTarget) ? reviewTarget : requirements[0].requirement_id;
      const prompt = element('input');
      prompt.required = true;
      prompt.maxLength = 300;
      const options = element('textarea');
      options.rows = 3;
      options.required = true;
      function suggest() {
        const requirement = requirements.find(req => req.requirement_id === target.value);
        const suggestion = requirement.customer_review_question;
        prompt.value = String(suggestion?.prompt || requirement.open_questions?.[0] || '「' + requirement.title + '」是否符合你的使用预期？').slice(0, 300);
        options.value = Array.isArray(suggestion?.options) ? suggestion.options.join('\n') : requirement.open_questions?.length ? '' : '符合，可以按当前方案推进\n基本符合，补充细节后可以推进\n需要调整后再确认';
      }
      target.addEventListener('change', suggest);
      suggest();
      const remove = iconLabel(element('button', '删除问题', 'button danger ghost small'), 'trash');
      remove.type = 'button';
      remove.addEventListener('click', () => {
        const neighbour = row.nextElementSibling || row.previousElementSibling;
        row.remove();
        updateActions();
        (neighbour?.querySelector('select') || add).focus();
      });
      row.append(element('legend', '客户可见问题'));
      for (const [name, control] of [['关联需求（内部）', target], ['问题', prompt], ['候选项（每行一项）', options]]) {
        const label = element('label', name);
        label.append(control === target ? selectControl(control) : control);
        row.append(label);
      }
      row.append(remove);
      questions.append(row);
      updateActions();
      return target;
    }
    add.addEventListener('click', () => addQuestion().focus());
    addQuestion();
    const actions = element('div', null, 'customer-question-actions');
    actions.append(add, publish);
    form.append(questions, actions, status);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (publish.disabled) return;
      publish.disabled = true; add.disabled = true;
      for (const row of questions.children) row.disabled = true;
      status.textContent = '正在生成答题链接…';
      try {
        const entries = Array.from(questions.children, row => ({
          target: row.querySelector('select').value,
          prompt: row.querySelector('input').value,
          options: row.querySelector('textarea').value.split(/\r?\n/).map(option => option.trim()).filter(Boolean),
        }));
        const result = await localRequest('/api/customer-review', {method: 'POST', body: JSON.stringify({questions: entries})});
        const link = element('a', result.url);
        link.href = result.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        status.replaceChildren(document.createTextNode('把这个链接发给参会客户：'), link);
      } catch (error) { status.textContent = error.message; }
      finally {
        for (const row of questions.children) row.disabled = false;
        updateActions();
      }
    });
    card.append(form);
  }
  function review() {
    // Three steps people actually take: answer open questions, look back at what was decided, deliver.
    // The on-site customer questionnaire is optional and appears only when its server is running.
    // Decisions are made on each page (requirements, documents); this page is the log plus delivery.
    if (['changes', 'questions'].includes(reviewTab)) reviewTab = 'records';
    if (reviewTab === 'customer' && !serverState?.customer_review_enabled) reviewTab = 'records';
    const tabs = sectionTabs([
      ['records', '评审记录', 'review'], ...(serverState?.customer_review_enabled ? [['customer', '客户复核', 'actors']] : []),
      ['delivery', '交付', 'package'],
    ], reviewTab, '评审内容', key => { reviewTab = key; render(); });
    tabs.classList.add('review-tabs', 'page-tabs');
    content.append(tabs);
    if (reviewTab === 'customer') { customerReview(); return; }
    if (reviewTab === 'delivery') { releasePanel(); return; }
    if (reviewTab === 'records') {
      // One log: what changed in this version (if anything), then each recorded verdict.
      const changes = data.diff?.changes || [];
      const conflicts = data.diff?.conflicts || [];
      if (changes.length || conflicts.length) {
        const versionCard = panel('本版相对 ' + (project.baseline_version || '上一版') + ' 的变化', 'history');
        versionCard.classList.add('version-changes');
        for (const change of changes) {
          const req = requirements.find(item => item.requirement_id === change.target);
          versionCard.append(element('p', (req?.title || change.target) + ' · ' + change.field + '：' + display(change.old) + ' → ' + display(change.new), 'version-change'));
        }
        for (const conflict of conflicts) versionCard.append(element('p', '需要核对：' + conflict.target + ' · ' + conflict.field + '（保留「' + display(conflict.retained) + '」，建议「' + display(conflict.proposed) + '」）', 'version-change conflict'));
        content.append(versionCard);
      }
      versionHistory();
      const records = [...(data.review.decisions || []), ...(serverState?.review.decisions || [])];
      const seen = new Set();
      const labels = {confirmed: '已确认', needs_changes: '需要修改', parked: '暂缓'};
      records.forEach(record => {
        const identity = JSON.stringify(record); if (seen.has(identity) || !matches(record)) return; seen.add(identity);
        const req = requirements.find(item => item.requirement_id === record.target);
        const card = panel(req?.title || record.target || '评审意见', 'review');
        card.classList.add('review-entry'); card.dataset.outcome = record.outcome;
        const note = iconLabel(element('p', labels[record.outcome] || record.outcome, 'review-decision'), record.outcome === 'confirmed' ? 'decided' : record.outcome === 'parked' ? 'pause' : 'edit');
        const head = element('header', null, 'review-entry-head');
        head.append(card.firstElementChild, note); card.append(head);
        fields(card, [['意见', record.comment], ['记录人', record.reviewer], ['时间', record.decided_at || record.created_at || record.created]].filter(([, value]) => value));
        content.append(card);
      });
      if (!seen.size && !changes.length && !conflicts.length && !(data.history || []).length) content.append(empty('还没有评审记录。在「功能需求」里对需求给出结论或修改后，会记在这里'));
      return;
    }
  }
  // How each version came to be, newest first: analysis, verdicts applied (with the decisions), generation, edits.
  function versionHistory() {
    const history = (data.history || []).slice().reverse();
    if (!history.length) return;
    const card = panel('版本记录', 'history');
    card.classList.add('version-history');
    const kinds = {analysis: '分析会议', review: '评审生效', generation: '生成成果', document: '修改文档'};
    const outcomes = {confirmed: '确认', needs_changes: '需要修改', parked: '暂缓'};
    const capabilities = {architecture: '技术架构', modules: '业务模块', erd: '数据模型', workflow: '流程图', prototype: '原型'};
    const list = element('ol', null, 'version-history-list');
    for (const entry of history) {
      const item = element('li', null, entry.version === project.artifact_version ? 'current' : '');
      const head = element('div', null, 'version-history-head');
      head.append(element('strong', entry.version), element('span', kinds[entry.kind] || entry.kind, 'pr-kind'), element('span', '基于 ' + (entry.baseline_version || '—') + ' · ' + String(entry.created || '').slice(0, 16).replace('T', ' '), 'inline-note'));
      item.append(head);
      const facts = [];
      if (entry.decisions?.length) {
        const counts = {};
        entry.decisions.forEach(decision => { counts[decision.outcome] = (counts[decision.outcome] || 0) + 1; });
        facts.push(entry.decisions.length + ' 条结论（' + Object.entries(counts).map(([key, count]) => (outcomes[key] || key) + ' ' + count).join('、') + '）');
      }
      if (entry.changes) facts.push(entry.changes + ' 处内容变化');
      if (entry.conflicts) facts.push(entry.conflicts + ' 处需核对');
      if (entry.document) facts.push('修改 ' + entry.document);
      const made = (entry.generated || []).filter(item => item.status === 'success');
      if (made.length) facts.push('成果：' + made.map(item => (capabilities[item.capability] || item.capability) + (item.reused_from ? '（沿用 ' + item.reused_from + '）' : '')).join('、'));
      if (facts.length) item.append(element('p', facts.join(' · '), 'version-history-facts'));
      if (entry.decisions?.length) {
        const rows = element('ul', null, 'version-history-decisions');
        for (const decision of entry.decisions) {
          const req = requirements.find(r => r.requirement_id === decision.target) || (project.nfrs || []).find(n => n.nfr_id === decision.target);
          rows.append(element('li', (req?.title || decision.target) + '：' + (outcomes[decision.outcome] || decision.outcome) + (decision.comment ? ' · ' + decision.comment : '')));
        }
        item.append(rows);
      }
      list.append(item);
    }
    card.append(list);
    content.append(card);
  }
  function technical() {
    const tabs = {diagrams: '技术架构', database: '数据模型', api: '接口'};
    const navigation = element('div', null, 'technical-tabs page-tabs');
    navigation.setAttribute('role', 'tablist');
    navigation.setAttribute('aria-label', '技术设计分类');
    const panelNode = element('section');
    panelNode.id = 'technical-panel';
    panelNode.setAttribute('role', 'tabpanel');
    panelNode.setAttribute('aria-labelledby', 'tab-' + technicalTab);
    content.append(navigation, panelNode);
    for (const [key, label] of Object.entries(tabs)) {
      const button = iconLabel(element('button', label), {diagrams: 'technical', database: 'database', api: 'api'}[key]);
      button.id = 'tab-' + key;
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', 'technical-panel');
      button.setAttribute('aria-selected', String(key === technicalTab));
      button.tabIndex = key === technicalTab ? 0 : -1;
      button.addEventListener('click', () => { technicalTab = key; render(); document.getElementById('tab-' + key).focus(); });
      button.addEventListener('keydown', event => {
        const keys = Object.keys(tabs);
        let index = keys.indexOf(key);
        if (event.key === 'ArrowRight') index = (index + 1) % keys.length;
        else if (event.key === 'ArrowLeft') index = (index + keys.length - 1) % keys.length;
        else if (event.key === 'Home') index = 0;
        else if (event.key === 'End') index = keys.length - 1;
        else return;
        event.preventDefault();
        technicalTab = keys[index];
        render();
        document.getElementById('tab-' + technicalTab).focus();
      });
      navigation.append(button);
    }
    // Existing section renderers append to the shared content root.
    const before = new Set(content.children);
    if (technicalTab === 'database') database();
    else if (technicalTab === 'api') api();
    else technicalArchitecture();
    Array.from(content.children).filter(child => !before.has(child)).forEach(child => panelNode.append(child));
  }

  function render() {
    moduleFrame = null; selectDiagramModule = null;
    content.replaceChildren();
    const title = document.getElementById('page-title');
    title.textContent = views[active];
    iconLabel(title, active);
    document.title = views[active] + ' · ' + shortName;
    document.querySelectorAll('[data-view]').forEach(button => {
      button.classList.toggle('active', button.dataset.view === active);
      if (button.dataset.view === active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    const searchLabels = {materials: '搜索素材或会议原话', modules: '搜索需求、规则或依据', review: '搜索评审问题', technical: '搜索表、字段或接口'};
    queryInput.placeholder = searchLabels[active] || '搜索';
    queryInput.setAttribute('aria-label', queryInput.placeholder);
    statusInput.hidden = true;
    evidenceInput.hidden = true;
    document.getElementById('requirement-filters')?.remove();
    if (active === 'modules') {
      const filters = iconLabel(element('button', (showFilters ? '收起筛选' : '筛选') + ((statusInput.value || evidenceInput.value) ? ' · 已启用' : ''), 'button small'), 'filter');
      filters.id = 'requirement-filters'; filters.type = 'button'; filters.setAttribute('aria-expanded', String(showFilters));
      filters.addEventListener('click', () => { showFilters = !showFilters; render(); document.getElementById('requirement-filters').focus(); });
      document.querySelector('.workbench-toolbar').append(filters);
      if (showFilters) {
        const filterPanel = element('div', null, 'filter-panel');
        for (const [input, title] of [[statusInput, '需求状态'], [evidenceInput, '证据类型']]) {
          filterPanel.append(sectionTabs(Array.from(input.options).map(option => [option.value, option.textContent.replace('全部需求状态', '全部状态').replace('全部证据类型', '全部依据')]), input.value, title, key => { input.value = key; render(); }));
        }
        content.append(filterPanel);
      }
    }
    document.querySelector('.workbench-toolbar').hidden = !['modules', 'review'].includes(active) && !(active === 'technical' && technicalTab === 'api');
    const renderers = {overview, materials, modules, documents, prototype, technical, review};
    renderers[active]();
  }
  function navigate(view) {
    if (['database', 'api', 'diagrams'].includes(view)) { technicalTab = view; view = 'technical'; }
    active = Object.hasOwn(views, view) ? view : 'overview';
    history.replaceState(null, '', '#' + active);
    render();
    document.getElementById('page-title').focus();
  }
  const icons = {
    overview: 'M4 4h7v7H4z M13 4h7v4h-7z M13 11h7v9h-7z M4 14h7v6H4z',
    materials: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M5 11a7 7 0 0 0 14 0 M12 18v3',
    modules: 'M10 6h10 M10 12h10 M10 18h10 M4 6l1 1 2-2 M4 12l1 1 2-2 M4 18l1 1 2-2',
    documents: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M9 13h6 M9 17h6',
    prototype: 'M3 5h18v11H3z M8 20h8 M12 16v4',
    technical: 'M4 4h6v6H4z M14 14h6v6h-6z M10 7h4a3 3 0 0 1 3 3v4',
    review: 'M4 5h16v11H10l-6 4z M9 10.5l2 2 4-4',
    search: 'M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14z M20 20l-4-4',
    sidebar: 'M3 5h18v14H3z M9 5v14',
    clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3 2',
    decided: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M8 12l2.7 2.7L16 9',
    conditional: 'M4 12h5l4-5h7 M9 12l4 5h7 M17 4l3 3-3 3 M17 14l3 3-3 3',
    proposal: 'M9 18h6 M10 21h4 M8 13a5.6 5.6 0 1 1 8 0c-1.2 1-1.7 2-1.7 3H9.7c0-1-.5-2-1.7-3z',
    pending: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M9.5 9a2.6 2.6 0 1 1 4 2.2c-1 .6-1.5 1.1-1.5 2 M12 17h.01',
    download: 'M12 3v12 M8 11l4 4 4-4 M4 17v4h16v-4',
    external: 'M13 4h7v7 M20 4l-9 9 M10 5H5v14h14v-5',
    quote: 'M4 5h16v12H9l-5 3z M8 9h8 M8 13h5',
    close: 'M6 6l12 12 M6 18L18 6',
    folder: 'M3 6h7l2 2h9v11H3z',
    actors: 'M10 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M4 20v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2 M16 6a3 3 0 0 1 0 6 M18 14a4 4 0 0 1 2 4v2',
    pause: 'M9 5v14 M15 5v14',
    edit: 'M4 16l-1 5 5-1L20 8l-4-4z M14 6l4 4',
    back: 'M5 12h14 M5 12l5-5 M5 12l5 5',
    print: 'M6 8V3h12v5 M6 17H3V8h18v9h-3 M6 14h12v7H6z M7 11h.01',
    mobile: 'M7 3h10v18H7z M11 18h2',
    database: 'M4 6c0-4 16-4 16 0s-16 4-16 0z M4 6v12c0 4 16 4 16 0V6 M4 12c0 4 16 4 16 0',
    api: 'M8 7l-5 5 5 5 M16 7l5 5-5 5 M14 5l-4 14',
    info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 11v5 M12 8h.01',
    copy: 'M9 9h11v12H9z M15 9V3H4v12h5',
    refresh: 'M20 8a8 8 0 1 0 0 8 M20 3v5h-5',
    history: 'M4 5v5h5 M4 10a8 8 0 1 1 1.5 7 M12 8v4l3 2',
    package: 'M3 7l9-4 9 4v11l-9 4-9-4z M3 7l9 4 9-4 M12 11v11 M8 5l9 4',
    plus: 'M12 5v14 M5 12h14',
    trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 10v7 M14 10v7',
    link: 'M9 15l6-6 M9 17l-2 2a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0 M15 7l2-2a3.5 3.5 0 0 1 5 5l-4 4a3.5 3.5 0 0 1-5 0',
    chevron: 'M6 9l6 6 6-6',
    filter: 'M4 5h16l-6 7v5l-4 2v-7z',
    play: 'M8 5l11 7-11 7z',
    upload: 'M12 15V3 M8 7l4-4 4 4 M4 17v4h16v-4',
  };
  function icon(name) {
    const svg = svgNode('svg', {viewBox: '0 0 24 24', class: 'nav-icon', 'aria-hidden': 'true'});
    svg.append(svgNode('path', {d: icons[name]}));
    return svg;
  }
  function iconLabel(node, name) {
    const marker = icon(name); marker.classList.add('label-icon');
    node.classList.add('icon-label'); node.prepend(marker);
    return node;
  }
  // Every page search is a small magnifier that widens while focused or holding a query.
  function compactSearch(input) {
    const wrapper = element('label', null, 'compact-search');
    wrapper.title = input.placeholder || '搜索';
    const sync = () => wrapper.classList.toggle('has-value', Boolean(input.value));
    input.addEventListener('input', sync); sync();
    wrapper.append(icon('search'), input);
    return wrapper;
  }
  function selectControl(select) {
    const wrapper = element('span', null, 'select-control');
    wrapper.append(select, icon('chevron'));
    return wrapper;
  }
  const fullName = project.name || project.project_id;
  const shortName = project.short_name || String(fullName).split(/\s+[·｜|—–-]\s+/)[0];
  const brand = document.getElementById('project-brand');
  brand.textContent = shortName; brand.parentElement.title = fullName;
  const workspace = document.querySelector('.workspace');
  const sidebarToggle = document.getElementById('toggle-sidebar');
  function collapseSidebar(collapsed) {
    workspace.classList.toggle('sidebar-collapsed', collapsed);
    sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
    sidebarToggle.title = collapsed ? '展开侧栏' : '收起侧栏';
    sidebarToggle.setAttribute('aria-label', sidebarToggle.title);
    try { localStorage.setItem('workbench-sidebar', collapsed ? 'collapsed' : 'open'); } catch (error) { /* preference only */ }
  }
  sidebarToggle.prepend(icon('sidebar'));
  sidebarToggle.addEventListener('click', () => collapseSidebar(!workspace.classList.contains('sidebar-collapsed')));
  let sidebarPreference = null;
  try { sidebarPreference = localStorage.getItem('workbench-sidebar'); } catch (error) { /* preference only */ }
  collapseSidebar(sidebarPreference === 'collapsed');

  const searchDialog = element('dialog', null, 'search-dialog');
  searchDialog.setAttribute('aria-label', '搜索项目');
  const searchInput = element('input'); searchInput.type = 'search'; searchInput.placeholder = '搜索需求、会议原话或页面';
  searchInput.setAttribute('aria-label', searchInput.placeholder);
  const searchResults = element('div', null, 'search-results');
  searchDialog.append(searchInput, searchResults); document.body.append(searchDialog);
  function searchResult(label, meta, open) {
    const button = element('button', null, 'search-result'); button.type = 'button';
    button.append(element('span', label)); if (meta) button.append(element('span', meta, 'search-meta'));
    button.addEventListener('click', () => { searchDialog.close(); open(); });
    return button;
  }
  function runSearch() {
    const term = searchInput.value.trim().toLowerCase();
    searchResults.replaceChildren();
    const has = value => String(value ?? '').toLowerCase().includes(term);
    const groups = [];
    const pages = Object.entries(views).filter(([, title]) => !term || has(title));
    groups.push(['页面', pages.map(([view, title]) => searchResult(title, '', () => navigate(view)))]);
    if (term) {
      groups.push(['需求', requirements.filter(req => has(req.title) || has(req.requirement_id) || has(JSON.stringify(req.behavior ?? ''))).slice(0, 8)
        .map(req => searchResult(req.title, states[req.review_status] || '', () => openRequirement(req)))]);
      groups.push(['会议原话', data.sources.filter(source => source.source_type === 'transcript' && has(source.text)).slice(0, 8)
        .map(source => searchResult(source.text, locatorLabel(source.locator || {}), () => openSource(source.source_id)))]);
    }
    groups.filter(([, items]) => items.length).forEach(([title, items]) => searchResults.append(element('p', title, 'search-group'), ...items));
    if (!searchResults.childElementCount) searchResults.append(element('p', '没有匹配的内容', 'search-empty'));
  }
  function openSearch() { if (searchDialog.open) return; searchInput.value = ''; runSearch(); searchDialog.showModal(); searchInput.focus(); }
  searchInput.addEventListener('input', runSearch);
  searchInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); searchResults.querySelector('.search-result')?.click(); } });
  searchDialog.addEventListener('click', event => { if (event.target === searchDialog) searchDialog.close(); });
  {
    const toolbar = document.querySelector('.workbench-toolbar');
    const next = queryInput.nextSibling; const parent = queryInput.parentElement;
    parent.insertBefore(compactSearch(queryInput), next);
    document.querySelector('.page-header').append(toolbar);
  }
  const searchButton = document.getElementById('open-search');
  searchButton.append(icon('search')); searchButton.addEventListener('click', openSearch);
  document.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSearch(); } });

  for (const [view, title] of Object.entries(views)) {
    const button = element('button', null, 'nav-button');
    button.append(icon(view), element('span', title, 'nav-label'));
    button.title = title;
    button.dataset.view = view;
    button.addEventListener('click', () => {
      selectedSource = null;
      queryInput.value = '';
      statusInput.value = '';
      evidenceInput.value = '';
      navigate(view);
    });
    document.getElementById('navigation').append(button);
  }
  function downloadJson(value, name) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], {type: 'application/json'}));
    const link = element('a'); link.href = url; link.download = name;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  [queryInput, statusInput, evidenceInput].forEach(input => input.addEventListener('input', () => { selectedSource = null; render(); }));
  window.addEventListener('message', event => {
    if (active !== 'modules' || !moduleFrame || event.source !== moduleFrame.contentWindow) return;
    if (event.data?.type === 'product-requirements:module-size' && Number.isFinite(event.data.height)) { moduleFrame.style.height = Math.max(200, Math.min(1800, event.data.height)) + 'px'; return; }
    if (event.data?.type !== 'product-requirements:module-select') return;
    const match = /^module_(\d+)$/.exec(event.data.id || '');
    if (match && Number(match[1]) < (project.modules || []).length) selectDiagramModule?.(Number(match[1]));
  });
  window.addEventListener('hashchange', () => navigate(location.hash.slice(1)));
  navigate(location.hash.slice(1));
  if (location.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(location.hostname)) {
    refreshLocal().then(render).catch(error => { intakeMessage = error.message; });
  }
})();
