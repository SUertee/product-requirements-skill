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
  let selectedDocument = ['proposal.md', 'prd.md', 'schedule'].includes(requestedDocument) ? requestedDocument : 'proposal.md';
  let handoffOpen = requestedDocument === 'agent-prompt.md';
  let handoffMessage = '';
  let intakeSource = 'file';
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
  let reviewTab = 'questions';
  let workflowBusy = false;
  let workflowMessage = '';
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
    const labels = {title: '标题', role: '角色', trigger: '触发', behavior: '行为', inputs: '输入', outputs: '输出', rules: '规则', exceptions: '异常', acceptance_criteria: '验收', lifecycle_status: '生命周期'};
    for (const [key, label] of Object.entries(labels)) { const option = element('option', label); option.value = key; select.append(option); }
    const fieldLabel = element('label', '字段'); fieldLabel.htmlFor = select.id;
    const text = element('textarea'); text.id = 'edit-value-' + req.requirement_id; text.rows = 4;
    const textLabel = element('label', '新内容'); textLabel.htmlFor = text.id;
    const lockLabel = element('label', null, 'workflow-check'); const lock = element('input'); lock.type = 'checkbox'; lockLabel.append(lock, element('span', '锁定此字段'));
    const message = element('p', '', 'inline-note'); message.setAttribute('role', 'status');
    function loadField() {
      const pending = pendingChanges.find(item => item.target === req.requirement_id && item.field === select.value);
      const value = pending ? pending.value : req[select.value];
      text.value = value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      const locks = pendingChanges.find(item => item.target === req.requirement_id && item.field === 'locked_fields')?.value || req.locked_fields || [];
      lock.checked = locks.includes(select.value); text.readOnly = lock.checked;
    }
    select.addEventListener('change', loadField); lock.addEventListener('change', () => { text.readOnly = lock.checked; }); loadField();
    const submit = iconLabel(element('button', '加入修订草稿', 'button primary'), 'edit'); submit.type = 'submit';
    form.append(fieldLabel, select, textLabel, text, lockLabel, submit, message);
    form.addEventListener('submit', event => {
      event.preventDefault();
      try {
        const raw = text.value.trim();
        let value = raw.startsWith('[') || raw.startsWith('{') ? JSON.parse(raw) : raw || null;
        if (select.value === 'lifecycle_status' && value !== null && !['active', 'cancelled'].includes(value)) throw new Error('生命周期使用 active 或 cancelled');
        const key = select.value;
        pendingChanges = pendingChanges.filter(item => !(item.target === req.requirement_id && item.field === key));
        if (JSON.stringify(req[key] ?? null) !== JSON.stringify(value)) pendingChanges.push({target: req.requirement_id, field: key, value});
        const original = req.locked_fields || [];
        const current = new Set(pendingChanges.find(item => item.target === req.requirement_id && item.field === 'locked_fields')?.value || original);
        if (lock.checked) current.add(key); else current.delete(key);
        pendingChanges = pendingChanges.filter(item => !(item.target === req.requirement_id && item.field === 'locked_fields'));
        if (JSON.stringify([...current].sort()) !== JSON.stringify([...original].sort())) pendingChanges.push({target: req.requirement_id, field: 'locked_fields', value: [...current].sort()});
        message.textContent = '已暂存，前往评审记录应用修订并生成新版本';
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
  function requirementChoice(req, current, onSelect) {
    const button = element('button', null, 'requirement-choice'); button.type = 'button';
    button.dataset.requirementId = req.requirement_id;
    button.title = '需求编号 ' + req.requirement_id;
    button.setAttribute('aria-pressed', String(req === current));
    const status = element('span', states[req.review_status] || '草稿', 'requirement-choice-status');
    status.dataset.status = req.review_status;
    button.append(element('strong', req.title), status);
    button.addEventListener('click', onSelect);
    return button;
  }
  function requirementCard(req) {
    const card = panel(req.title);
    card.classList.add('requirement-inspector');
    const identity = element('div', null, 'requirement-identity');
    const evidence = iconLabel(element('span', evidenceNames[req.evidence_type] || '待确认', 'evidence-tag'), 'quote');
    evidence.dataset.evidence = req.evidence_type || 'unknown';
    const statusMarker = {confirmed: 'decided', draft: 'clock', disputed: 'pending', parked: 'pause'};
    const status = iconLabel(element('span', states[req.review_status] || '草稿', 'status-tag'), statusMarker[req.review_status] || 'clock');
    status.dataset.status = req.review_status;
    identity.append(evidence, status, element('span', req.requirement_id, 'requirement-code'));
    card.append(identity);
    const body = element('div', null, 'requirement-tab-body');
    const editing = requirementTab === 'edit' && serverState;
    if (editing) body.append(requirementEditor(req));
    else {
      const section = (label, marker, style) => {
        const entry = element('section', null, 'requirement-section ' + style);
        entry.append(iconLabel(element('h3', label), marker));
        return entry;
      };
      const summary = element('div', null, 'requirement-summary');
      const behavior = section('功能内容', 'documents', 'requirement-behavior');
      behavior.append(valueNode(req.behavior));
      const acceptance = section('验收标准', 'decided', 'requirement-acceptance');
      acceptance.append(valueNode(req.acceptance_criteria));
      summary.append(behavior, acceptance); body.append(summary);

      if (req.open_questions?.length) {
        const questions = section('需要确认', 'pending', 'requirement-questions');
        questions.append(valueNode(req.open_questions)); body.append(questions);
      }
      const known = [['使用者', req.role], ['触发条件', req.trigger], ['输入', req.inputs], ['输出', req.outputs], ['处理约束', req.rules]].filter(([, value]) => display(value) !== '待确认');
      if (known.length) {
        const rules = section('业务规则', 'modules', 'requirement-rules');
        fields(rules, known); body.append(rules);
      }
      if (display(req.exceptions) !== '待确认') {
        const exceptions = section('异常处理', 'conditional', 'requirement-exceptions');
        exceptions.append(valueNode(req.exceptions)); body.append(exceptions);
      }

      const sources = section('会议原话', 'quote', 'requirement-sources');
      if (!(req.source_refs || []).length) sources.append(element('p', '来源待补充', 'inline-note'));
      for (const sourceId of req.source_refs || []) {
        const source = sourceMap.get(sourceId);
        const citation = element('div', null, 'requirement-citation');
        citation.append(sourceLink(sourceId), element('blockquote', source?.text || '来源待补充', 'source-quote'));
        sources.append(citation);
      }
      body.append(sources);
      appendCustomerFeedback(body, req.requirement_id);
    }
    const actions = element('div', null, 'requirement-actions');
    const reviewButton = iconLabel(element('button', '记录评审意见', 'button ghost small'), 'review');
    reviewButton.type = 'button';
    reviewButton.addEventListener('click', () => { reviewTarget = req.requirement_id; reviewTab = 'questions'; navigate('review'); });
    actions.append(reviewButton);
    if (serverState) {
      const edit = iconLabel(element('button', editing ? '返回需求' : '修改', 'button ghost small'), editing ? 'back' : 'edit'); edit.type = 'button';
      edit.addEventListener('click', () => { requirementTab = editing ? 'detail' : 'edit'; card.replaceWith(requirementCard(req)); });
      actions.append(edit);
    }
    card.append(body, actions);
    return card;
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
      } else row.addEventListener('click', () => { if (view === 'review') reviewTab = 'questions'; navigate(view); });
      outputs.append(row);
    }
    if (handoffOpen && handoffReady) outputs.append(handoffPreview());
    const columns = element('div', null, 'overview-sections');
    columns.append(outputs);
    const followUp = panel('待确认事项', 'pending');
    const questions = [...explicit, ...(data.review.questions || []).filter(item => item.reason !== '核对依据、范围与确认状态')];
    const unique = questions.filter((item, index) => questions.findIndex(other => item.reason === other.reason) === index);
    for (const question of unique.slice(0, 3)) {
      const item = element('button', null, 'output-row'); item.type = 'button';
      item.append(element('span', question.reason), element('span', '→'));
      item.addEventListener('click', () => { reviewTarget = question.target; reviewTab = 'questions'; navigate('review'); });
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
    const labels = {ready_for_analysis: '待 Skill 分析', awaiting_transcript: '等待转写', failed: '处理失败', processing: '处理中'};
    const analysisLabels = {waiting_host: '等待宿主分析', running: '分析执行中', failed: '分析失败', completed: '已生成分析版本'};
    for (const job of [...serverState.jobs].reverse()) {
      const row = element('section', null, 'intake-row');
      const analysis = analysisFor(job);
      const statusLabel = analysis ? analysisLabels[analysis.status] : job.status === 'awaiting_transcript' && hasTranscript(job) ? '已有转写' : labels[job.status] || job.status;
      const head = element('div', null, 'intake-row-head');
      head.append(element('strong', job.name));
      badges(head, [statusLabel, job.kind === 'recording' ? '音视频' : '逐字稿', job.source_count ? job.source_count + ' 段原话' : job.stage]);
      const actions = element('div', null, 'document-actions');
      if (job.status === 'ready_for_analysis' && job.source_count) {
        const view = element('button', '查看原话', 'button small'); view.type = 'button';
        view.addEventListener('click', () => { materialTab = 'library'; render(); });
        actions.append(view);
      }
      if (job.status === 'awaiting_transcript') {
        const linked = serverState.jobs.find(item => item.provenance.related_job_id === job.job_id && item.status === 'ready_for_analysis');
        if (!linked && serverState.asr_configured) {
          const asr = element('button', '转写', 'button small'); asr.type = 'button'; asr.disabled = intakeBusy;
          asr.addEventListener('click', () => importAction(() => localRequest('/api/transcribe', {method: 'POST', body: JSON.stringify({job_id: job.job_id})}))); actions.append(asr);
        }
      }
      if (job.status === 'failed') {
        const retry = iconLabel(element('button', '重试', 'button small'), 'refresh');
        retry.type = 'button'; retry.disabled = intakeBusy;
        retry.addEventListener('click', () => importAction(() => localRequest('/api/retry', {method: 'POST', body: JSON.stringify({job_id: job.job_id})})));
        actions.append(retry);
      }
      head.append(actions);
      row.append(head);
      if (job.error) row.append(element('p', job.error, 'inline-note'));
      if (job.provenance.related_job_id) row.append(element('p', '关联录音 · ' + (serverState.jobs.find(item => item.job_id === job.provenance.related_job_id)?.name || job.provenance.related_job_id), 'inline-note'));
      const fileLinks = [['original', '原始素材'], ['sources', '来源片段'], ['analysis_request', '分析请求']].filter(([key]) => job.files[key]);
      const mediaKey = /\.(mp4|mov|webm|mkv)$/i.test(job.files.original || '') ? 'original' : job.files.audio ? 'audio' : 'original';
      const path = job.files[mediaKey];
      if (fileLinks.length || (job.kind === 'recording' && path && job.status !== 'failed')) {
        const more = element('details', null, 'intake-files');
        more.append(element('summary', '文件'));
        const links = element('div', null, 'document-actions');
        for (const [key, label] of fileLinks) links.append(jobLink(job, key, label));
        more.append(links);
        if (job.kind === 'recording' && path && job.status !== 'failed') {
          const player = element(/\.(mp4|mov|webm|mkv)$/i.test(path) ? 'video' : 'audio');
          player.controls = true; player.preload = 'none'; player.src = '/api/jobs/' + job.job_id + '/' + mediaKey;
          more.append(player);
        }
        row.append(more);
      }
      jobs.append(row);
    }
    if (!serverState.jobs.length) jobs.append(empty('还没有导入的会议'));
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
      workflowMessage = result.release ? '客户交付包已生成，可预览或下载' : result.task.status === 'completed' ? '新版本已生成，可从任务记录打开' : '分析请求已准备，等待宿主执行 Skill 并返回项目结果';
      const failures = result.task?.generation_results?.filter(item => item.generation_status === 'failed') || [];
      if (failures.length) workflowMessage = '版本已生成，成果生成失败 · ' + failures.map(item => item.error).join('；');
    } catch (error) { workflowMessage = error.message; }
    finally {
      workflowBusy = false;
      try { await refreshLocal(); } catch (error) { workflowMessage += ' · ' + error.message; }
      render();
    }
  }
  // Processing: one status line per material, one action to start the next version, details folded.
  function processingFlow() {
    const card = panel('处理进度');
    if (!serverState?.jobs.length) { card.append(empty('暂无素材，先在“导入”中添加会议')); content.append(card); return; }
    const versionTasks = serverState.tasks || [];
    for (const job of serverState.jobs) {
      const relatedJobs = [job.job_id, ...serverState.jobs.filter(item => item.provenance?.related_job_id === job.job_id).map(item => item.job_id)];
      const task = versionTasks.filter(item => item.kind === 'analysis' && (item.job_ids || []).some(id => relatedJobs.includes(id))).at(-1);
      const transcriptReady = job.status === 'ready_for_analysis' || hasTranscript(job);
      const failed = job.status === 'failed';
      const row = element('section', null, 'processing-item');
      const steps = element('ol', null, 'processing-flow'); steps.setAttribute('aria-label', job.name + '处理流程');
      const values = [
        ['接收', failed ? 'failed' : 'done'],
        ['转写', transcriptReady ? 'done' : failed ? 'todo' : 'waiting'],
        ['需求分析', task?.status === 'completed' ? 'done' : task?.status === 'failed' ? 'failed' : task ? 'waiting' : 'todo'],
        ['工作台', task?.status === 'completed' ? 'done' : 'todo'],
      ];
      for (const [title, state] of values) {
        const step = element('li', title); step.dataset.state = state;
        step.setAttribute('aria-label', title + '：' + ({done: '完成', waiting: '进行中', failed: '失败', todo: '未开始'}[state]));
        steps.append(step);
      }
      const head = element('div', null, 'processing-head');
      head.append(element('strong', job.name), steps);
      if (task?.status === 'completed') { const link = element('a', '打开 ' + task.version + ' →', 'source-link'); link.href = '/versions/' + task.id + '/workbench/index.html'; head.append(link); }
      row.append(head);
      if (job.error || task?.error) row.append(element('p', job.error || task.error, 'inline-note'));
      card.append(row);
    }
    content.append(card);
  }
  function analysisPanel() {
    if (!serverState) return;
    const card = panel('生成新版本');
    const present = new Set((project.materials || []).map(item => item.material_id));
    const ready = serverState.jobs.filter(item => item.status === 'ready_for_analysis');
    const form = element('form', null, 'intake-form');
    const choices = [];
    const roles = element('details', null, 'intake-advanced'); roles.append(element('summary', '更多选项'));
    for (const job of ready) {
      const check = element('label', null, 'workflow-check');
      const box = element('input'); box.type = 'checkbox'; box.checked = !present.has(job.material_id); box.disabled = workflowBusy;
      check.append(box, document.createTextNode(job.name + (present.has(job.material_id) ? '（已在当前版本）' : '')));
      const role = element('select'); role.id = 'analysis-' + job.job_id; role.disabled = workflowBusy;
      for (const [value, text] of [['meeting', '作为会议材料'], ['context', '作为前情资料']]) { const option = element('option', text); option.value = value; role.append(option); }
      const roleLabel = element('label', job.name); roleLabel.htmlFor = role.id;
      roles.append(roleLabel, role);
      choices.push([job.job_id, box, role]); form.append(check);
    }
    const version = element('input'); version.id = 'analysis-version'; version.value = nextVersion(); version.required = true; version.disabled = workflowBusy;
    const versionLabel = element('label', '版本号'); versionLabel.htmlFor = version.id;
    roles.append(versionLabel, version);
    const submit = iconLabel(element('button', '生成 ' + version.value, 'button primary'), 'documents'); submit.type = 'submit'; submit.disabled = workflowBusy || !ready.length;
    version.addEventListener('input', () => { submit.lastChild.textContent = '生成 ' + (version.value || '新版本'); });
    form.append(submit, roles);
    if (!ready.length) form.prepend(element('p', '没有可分析的素材。', 'inline-note'));
    form.addEventListener('submit', event => {
      event.preventDefault();
      const picked = choices.filter(([, box]) => box.checked);
      if (!picked.length) { workflowMessage = '请至少选择一份素材'; render(); return; }
      const job_ids = picked.map(([id]) => id);
      const context_job_ids = picked.filter(([, , role]) => role.value === 'context').map(([id]) => id);
      const selectedVersion = version.value;
      workflowAction(() => localRequest('/api/analysis', {method: 'POST', body: JSON.stringify({job_ids, context_job_ids, version: selectedVersion})}));
    });
    card.append(form);
    if (workflowMessage) { const message = element('p', workflowMessage, 'inline-note'); message.setAttribute('role', 'status'); card.append(message); }
    const labels = {waiting_host: '等待宿主分析', running: '生成中', failed: '失败，可重试', completed: '已生成'};
    const tasks = (serverState.tasks || []).filter(item => item.kind === 'analysis');
    const pending = tasks.filter(task => task.status !== 'completed');
    const done = tasks.filter(task => task.status === 'completed').slice(-3).reverse();
    for (const task of pending) {
      const row = element('section', null, 'inbox-row');
      row.append(element('h3', task.version + ' · 需求分析'));
      badges(row, [labels[task.status] || task.status]);
      if (task.error) row.append(element('p', task.error, 'inline-note'));
      const links = element('div', null, 'document-actions');
      for (const [key, label] of [['request', '分析请求'], ['baseline', '原基线'], ['sources', '完整来源']]) {
        const link = element('a', label, 'button ghost small'); link.href = '/api/tasks/' + task.id + '/' + key; link.target = '_blank'; link.rel = 'noopener'; links.append(link);
      }
      row.append(links);
      if (task.status !== 'running') {
        if (serverState.analysis_configured) {
          const execute = iconLabel(element('button', '执行已配置宿主', 'button primary'), 'play'); execute.type = 'button'; execute.disabled = workflowBusy;
          execute.addEventListener('click', () => workflowAction(() => localRequest('/api/analysis/execute', {method: 'POST', body: JSON.stringify({request_id: task.id})}))); row.append(execute);
        }
        const resultForm = element('form', null, 'intake-form');
        const label = element('label', '宿主返回的 project.json'); label.htmlFor = 'result-' + task.id;
        const file = element('input'); file.type = 'file'; file.accept = '.json'; file.required = true; file.id = label.htmlFor;
        const complete = iconLabel(element('button', '校验并生成新版本', 'button'), 'decided'); complete.type = 'submit'; complete.disabled = workflowBusy;
        resultForm.append(label, file, complete);
        resultForm.addEventListener('submit', event => {
          event.preventDefault(); const selected = file.files[0];
          if (!selected) return;
          workflowAction(async () => {
            const candidate = JSON.parse(await selected.text());
            return localRequest('/api/analysis/complete', {method: 'POST', body: JSON.stringify({request_id: task.id, project: candidate})});
          });
        });
        row.append(resultForm);
      }
      card.append(row);
    }
    if (done.length) {
      const history = element('details', null, 'intake-advanced'); history.append(element('summary', '最近生成的版本'));
      for (const task of done) {
        const link = element('a', task.version + ' · 打开工作台', 'source-link'); link.href = '/versions/' + task.id + '/workbench/index.html'; link.target = '_blank'; link.rel = 'noopener';
        history.append(link);
      }
      card.append(history);
    }
    content.append(card);
  }
  function materials() {
    content.append(sectionTabs([['library', '素材'], ['import', '导入'], ['processing', '处理流程']], materialTab, '会议素材视图', key => { materialTab = key; render(); }));
    if (materialTab === 'import') { intakePanel(); return; }
    if (materialTab === 'processing') { processingFlow(); analysisPanel(); return; }
    const entries = [];
    const assigned = new Set();
    for (const material of project.materials || []) {
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
    readingTools.append(search); card.append(readingTools);
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
    excerpts.forEach(source => {
      const excerpt = element('section', null, 'source-excerpt');
      if (source.source_id === selectedSource) { excerpt.classList.add('source-selected'); excerpt.tabIndex = -1; }
      const speakerPrefix = /^([\p{Script=Han}]{2,8}|说话人\s*\d+|Speaker\s*\d+)[：:]\s*/u.exec(source.text);
      const speaker = source.speaker || speakerPrefix?.[1];
      badges(excerpt, [locatorLabel(source.locator), speaker || '说话人待确认']);
      excerpt.dataset.sourceId = source.source_id;
      excerpt.append(element('blockquote', speakerPrefix ? source.text.slice(speakerPrefix[0].length) : source.text, 'source-quote'));
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
    head.append(element('h2', group.title));
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
    function select(id, reveal = false) {
      const node = nodes.find(item => item.id === id); if (!node) return;
      selectedArchitecture = id;
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
    host.append(picker, detail);
    select(nodes.some(node => node.id === selectedArchitecture) ? selectedArchitecture : nodes[0].id);
    return {host, select};
  }
  function technicalArchitecture() {
    const architecture = project.technical_architecture;
    if (!architecture?.components?.length) { content.append(empty('技术架构待确认')); return; }
    if (data.architecture_diagram) {
      const card = element('section', null, 'panel diagram-card'); card.setAttribute('aria-label', '技术架构');
      const head = element('div', null, 'module-surface-head');
      head.append(iconLabel(element('h2', architecture.review_status === 'confirmed' ? '系统组件' : '候选系统组件'), 'technical'));
      head.append(fileLink('diagrams/architecture.html', '独立打开')); card.append(head);
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
      frame.addEventListener('load', () => details.select(selectedArchitecture));
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
    const switcher = element('div', null, 'view-switcher'); switcher.setAttribute('role', 'group'); switcher.setAttribute('aria-label', '需求视图');
    for (const [view, label, marker] of [['list', '需求列表', 'modules'], ['map', '功能模块', 'technical'], ['usecases', '用例图', 'actors']]) {
      const button = iconLabel(element('button', label), marker); button.type = 'button'; button.setAttribute('aria-pressed', String(moduleView === view));
      button.addEventListener('click', () => { moduleView = view; render(); content.querySelector('.view-switcher [aria-pressed="true"]')?.focus(); }); switcher.append(button);
    }
    tools.append(switcher, element('span', visible.length + ' / ' + requirements.length + ' 条需求', 'module-count'));
    content.append(tools);
    if (workflowMessage) content.append(element('p', workflowMessage, 'inline-note'));
    if (!selected) { content.append(empty('暂无匹配需求，可调整搜索词或筛选条件')); return; }
    selectedModule = selected.key;
    if (moduleView === 'list') {
      const listed = choices.flatMap(group => group.items);
      const current = listed.find(req => req.requirement_id === selectedRequirement) || listed[0];
      if (!current) { content.append(empty('暂无需求')); return; }
      selectedRequirement = current.requirement_id;
      selectedModule = choices.find(group => group.items.includes(current)).key;
      const detail = element('section', null, 'module-detail panel requirement-card'); detail.setAttribute('aria-label', '需求列表');
      const layout = element('div', null, 'module-requirements');
      const picker = element('nav', null, 'requirement-picker'); picker.setAttribute('aria-label', '选择需求');
      choices.filter(group => group.items.length).forEach(group => {
        picker.append(iconLabel(element('p', group.title, 'requirement-group'), 'folder'));
        group.items.forEach(req => {
          picker.append(requirementChoice(req, current, () => {
            selectedRequirement = req.requirement_id; requirementTab = 'detail'; render();
            content.querySelector('.requirement-choice[aria-pressed="true"]')?.focus();
          }));
        });
      });
      layout.append(picker, requirementCard(current)); detail.append(layout); content.append(detail);
      return;
    }
    const filters = element('nav', null, 'module-filters'); filters.setAttribute('aria-label', '业务模块列表');
    const workspace = element('div', null, 'module-workspace');
    const surface = element('section', null, 'module-surface'); surface.setAttribute('aria-label', {map: '功能模块', usecases: '用例图', list: '需求列表'}[moduleView]);
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
      const head = element('div', null, 'module-surface-head'); head.append(iconLabel(element('h2', '业务模块'), 'modules'));
      head.append(fileLink('diagrams/modules.html', '独立打开')); surface.append(head);
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
  // Minimal schedule: work packages from modules, ordered by module dependencies; dates and owners are left for people.
  function workPackages() {
    const later = req => ['deferred', 'parked'].includes(req.review_status) || ['deferred', 'parked'].includes(req.lifecycle_status);
    const active = requirements.filter(req => req.lifecycle_status !== 'cancelled' && req.review_status !== 'cancelled');
    const modules = (project.modules || []).filter(module => (module.requirement_ids || []).some(id => active.some(req => req.requirement_id === id)));
    const packages = modules.length
      ? modules.map(module => ({id: module.module_id, name: module.name || module.module_id, reqs: active.filter(req => module.requirement_ids.includes(req.requirement_id))}))
      : active.map(req => ({id: req.requirement_id, name: req.title, reqs: [req]}));
    const known = new Set(packages.map(item => item.id));
    const after = new Map(packages.map(item => [item.id, new Set()]));
    for (const relation of project.module_relations || []) if (known.has(relation.from) && known.has(relation.to) && relation.from !== relation.to) after.get(relation.to).add(relation.from);
    const ordered = []; const placed = new Set();
    while (ordered.length < packages.length) {
      const next = packages.find(item => !placed.has(item.id) && [...after.get(item.id)].every(id => placed.has(id))) || packages.find(item => !placed.has(item.id));
      placed.add(next.id); ordered.push(next);
    }
    return ordered.map(item => ({...item, after: [...after.get(item.id)].map(id => packages.find(other => other.id === id)?.name || id), phase: item.reqs.every(later) ? '后续' : '本期'}));
  }
  function schedulePanel() {
    const card = panel('工作包时间线', 'pending');
    const packages = workPackages();
    if (!packages.length) { card.append(empty('整理出需求后显示工作包')); return card; }
    card.append(element('p', '按模块依赖排序。日期、负责人和工期都待确认，评审时由人填写，不由 Skill 推测。', 'inline-note'));
    for (const phase of ['本期', '后续']) {
      const rows = packages.filter(item => item.phase === phase);
      if (!rows.length) continue;
      card.append(element('h3', phase, 'schedule-phase'));
      const list = element('ol', null, 'schedule-list');
      for (const item of rows) {
        const row = element('li', null, 'schedule-item');
        const head = element('div', null, 'schedule-head');
        head.append(element('strong', item.name), element('span', '开始 待确认 · 结束 待确认 · 负责人 待确认', 'schedule-dates'));
        row.append(head);
        const meta = element('p', null, 'schedule-meta');
        meta.append(element('span', item.reqs.map(req => req.title).join('、')));
        if (item.after.length) meta.append(element('span', '依赖：' + item.after.join('、'), 'schedule-after'));
        row.append(meta);
        list.append(row);
      }
      card.append(list);
    }
    return card;
  }
  function documents() {
    const name = selectedDocument;
    const items = [['proposal.md', '项目方案', 'documents'], ['prd.md', 'PRD', 'modules'], ['schedule', '排期', 'pending']];
    if (name === 'schedule') {
      const tabs = sectionTabs(items, name, '文档类型', key => { selectedDocument = key; documentChapter = 0; documentEntry = 0; documentEditing = false; documentMessage = ''; render(); });
      tabs.classList.add('document-type-tabs');
      content.append(tabs, schedulePanel());
      return;
    }
    const derived = name === 'agent-prompt.md';
    if (derived) documentEditing = false;
    const tabs = sectionTabs(items, name, '文档类型', key => { selectedDocument = key; documentChapter = 0; documentEntry = 0; documentEditing = false; documentMessage = ''; render(); });
    tabs.classList.add('document-type-tabs');
    content.append(tabs);
    const text = documentDrafts[name] ?? data.documents[name] ?? '';
    const chunks = text.split(/(?=^## )/m);
    let intro = chunks.shift() || '';
    const chapterMarkers = {'文档信息': 'info', '模板参考': 'external', '原始依据': 'quote', '验收与待确认': 'decided', '验收与风险': 'pending', '功能需求': 'modules'};
    let chapters = chunks.map((chunk, index) => {
      const title = chunk.split('\n')[0].replace(/^## /, '');
      return {key: String(index), title, marker: Object.hasOwn(chapterMarkers, title) ? chapterMarkers[title] : 'documents', text: chunk};
    });
    if (!chapters.length) { intro = ''; chapters = [{key: '0', title: '正文', marker: 'documents', text}]; }
    documentChapter = Math.min(documentChapter, chapters.length - 1);
    const selectedIndex = documentChapter;
    const selected = chapters[selectedIndex];
    const detail = selectionLayout(chapters, String(selectedIndex), '文档章节', key => { documentChapter = Number(key); documentEntry = 0; documentEditing = false; });
    detail.parentElement.classList.add('document-workspace');
    const card = panel(selected.title, 'documents');
    card.classList.add('document-reader');
    const tools = element('header', null, 'document-reader-head');
    tools.append(card.firstElementChild);
    card.dataset.documentEditing = String(documentEditing);
    const actions = element('div', null, 'document-actions');
    const edit = iconLabel(element('button', documentEditing ? '预览本节' : '编辑本节', 'button small'), documentEditing ? 'prototype' : 'edit');
    edit.type = 'button'; edit.disabled = documentSaving;
    edit.addEventListener('click', () => { documentEditing = !documentEditing; render(); });
    const print = iconLabel(element('button', '打印 / PDF', 'button small'), 'print'); print.type = 'button';
    print.addEventListener('click', () => printDocument(name));
    const download = iconLabel(element('button', '下载正文', 'button small'), 'download'); download.type = 'button';
    download.addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([documentDrafts[name] ?? data.documents[name]], {type: 'text/markdown;charset=utf-8'}));
      const link = element('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    if (derived) {
      const copy = iconLabel(element('button', '复制全文', 'button primary small'), 'copy'); copy.type = 'button';
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(data.documents[name]); documentMessage = '已复制，可直接粘贴给 Coding Agent'; }
        catch { documentMessage = '浏览器未允许复制，请用“下载正文”'; }
        render();
      });
      actions.append(copy, download);
    } else actions.append(edit, print, download);
    const save = iconLabel(element('button', '保存新版本', 'button primary small'), 'decided'); save.type = 'button';
    save.disabled = documentSaving || !Object.hasOwn(documentDrafts, name) || documentDrafts[name] === data.documents[name];
    if (serverState && !derived) {
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
    const heading = selected.text.startsWith('## ') ? selected.text.split('\n')[0] : '';
    const chapterText = heading ? selected.text.split('\n').slice(1).join('\n') : selected.text;
    if (documentEditing) {
      const editor = element('textarea', null, 'document-editor');
      editor.id = 'document-editor'; editor.setAttribute('aria-label', selected.title + '正文');
      editor.rows = 18; editor.value = chapterText.trim(); editor.disabled = documentSaving;
      editor.addEventListener('input', () => {
        const revised = chapters.map((chapter, index) => index === selectedIndex ? (heading ? heading + '\n\n' : '') + editor.value + '\n\n' : chapter.text);
        documentDrafts[name] = intro + revised.join('');
        save.disabled = documentSaving || documentDrafts[name] === data.documents[name];
      });
      card.append(editor);
    } else {
      const entries = chapterText.split(/(?=^### )/m);
      const introduction = entries.shift() || '';
      if (entries.length > 1) {
        documentEntry = Math.min(documentEntry, entries.length - 1);
        const picker = element('div', null, 'document-entry-picker');
        picker.append(sectionTabs(entries.map((entry, index) => [String(index), entry.split('\n')[0].replace(/^### /, '')]), String(documentEntry), '章节条目', key => { documentEntry = Number(key); render(); }));
        card.append(picker, markdownDocument(introduction + entries[documentEntry]));
      } else card.append(markdownDocument(chapterText));
    }
    detail.append(card);
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
  function prototypeChecklist() {
    const nfrs = project.nfrs || [];
    const active = requirements.filter(req => req.review_status !== 'parked' && req.lifecycle_status !== 'cancelled');
    const confirmed = active.filter(req => req.review_status === 'confirmed');
    const noAcceptance = confirmed.filter(req => display(req.acceptance_criteria) === '待确认');
    const openNfrs = nfrs.filter(item => !['confirmed', 'parked'].includes(item.review_status));
    const design = project.prototype_design;
    const rows = [
      {done: active.length > 0 && confirmed.length === active.length, title: '确认功能需求', detail: active.length ? confirmed.length + ' / ' + active.length + ' 条已确认' : '尚无功能需求', view: 'review'},
      {done: confirmed.length > 0 && !noAcceptance.length, title: '补全验收标准', detail: !confirmed.length ? '确认需求后检查' : noAcceptance.length ? noAcceptance.map(req => req.title).join('、') + ' 缺验收标准' : '已确认需求都有验收标准', view: 'modules'},
      {done: nfrs.length > 0 && !openNfrs.length, title: '确认非功能需求', detail: !nfrs.length ? '尚未整理性能、权限、设备等非功能需求' : openNfrs.length ? openNfrs.length + ' 条待确认' : nfrs.length + ' 条已处理', view: nfrs.length ? 'review' : null},
      {done: Boolean(design), title: '原型设计', detail: design ? (design.pages || []).length + ' 个页面 · ' + (design.positioning?.product_type || '') : '由 Skill 按项目定位、需求和非功能需求设计页面', view: null},
    ];
    const card = panel('生成原型前');
    const list = element('ol', null, 'prototype-checklist');
    for (const row of rows) {
      const item = element('li', null, row.done ? 'done' : '');
      const body = element('div');
      body.append(element('strong', row.title), element('span', row.detail));
      item.append(element('span', row.done ? '✓' : '', 'check-mark'), body);
      if (row.view && !row.done) { const go = element('button', '去处理', 'button ghost small'); go.type = 'button'; go.addEventListener('click', () => navigate(row.view)); item.append(go); }
      list.append(item);
    }
    card.append(list);
    const ready = rows.every(row => row.done);
    if (ready && serverState) {
      const form = element('form', null, 'document-actions');
      const version = element('input'); version.value = nextVersion(); version.required = true; version.setAttribute('aria-label', '原型版本'); version.disabled = workflowBusy;
      const submit = iconLabel(element('button', '生成原型', 'button primary'), 'prototype'); submit.type = 'submit'; submit.disabled = workflowBusy;
      form.append(version, submit);
      form.addEventListener('submit', event => { event.preventDefault(); workflowAction(() => localRequest('/api/generate', {method: 'POST', body: JSON.stringify({version: version.value, kinds: ['prototype']})})); });
      card.append(form);
      if (workflowMessage) card.append(element('p', workflowMessage, 'inline-note'));
      const task = (serverState.tasks || []).filter(item => item.kind === 'generation' && item.status === 'completed').at(-1);
      if (task) { const link = element('a', '打开 ' + task.version, 'button ghost small'); link.href = '/versions/' + task.id + '/workbench/index.html#prototype'; card.append(link); }
    } else if (ready) card.append(element('p', '用本地服务打开工作台后可直接生成，或在 Skill 中执行原型生成。', 'inline-note'));
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
    const base = '../' + artifact.path.split('/').map(encodeURIComponent).join('/');
    frame.src = base + (prototypeAnnotate ? '?annotate=1' : '') + '#' + encodeURIComponent(selectedPrototypePage);
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
    const layout = element('div', null, 'prototype-layout');
    const list = element('nav', null, 'selection-list'); list.setAttribute('aria-label', '原型页面');
    const side = element('div', null, 'prototype-stage');
    const mapping = element('section', null, 'panel prototype-mapping');
    function drawMapping() {
      const page = pages.find(item => item.page_id === selectedPrototypePage);
      list.querySelectorAll('[data-selection-key]').forEach(node => { if (node.dataset.selectionKey === page.page_id) node.setAttribute('aria-current', 'true'); else node.removeAttribute('aria-current'); });
      mapping.replaceChildren(iconLabel(element('h2', page.name), 'documents'), element('p', page.purpose, 'prototype-purpose'));
      const reqs = (page.requirement_ids || []).map(id => requirements.find(req => req.requirement_id === id)).filter(Boolean);
      if (reqs.length) {
        mapping.append(element('h3', '功能需求'));
        const rows = element('ul', null, 'prototype-links');
        reqs.forEach(req => { const row = element('li'); row.append(requirementLink(req), element('span', req.requirement_id, 'muted-id')); rows.append(row); });
        mapping.append(rows);
      }
      const pageNfrs = (page.nfr_ids || []).map(id => nfrs.find(item => item.nfr_id === id)).filter(Boolean);
      if (pageNfrs.length) {
        mapping.append(element('h3', '非功能需求'));
        const rows = element('ul', null, 'prototype-nfrs');
        pageNfrs.forEach(item => { const row = element('li'); row.append(element('strong', item.title), element('span', nfrCategories[item.category] || item.category, 'nfr-category'), element('p', item.prototype_treatment?.note || item.statement)); rows.append(row); });
        mapping.append(rows);
      }
      const stateNames = {empty: '空数据', loading: '加载中', error: '出错', denied: '无权限', success: '成功'};
      const roleNames = Object.fromEntries((design.roles || []).map(role => [role.role_id, role.name]));
      const extra = [];
      if (page.states?.length) extra.push(['页面状态', page.states.map(state => stateNames[state] || state).join('、')]);
      if (page.roles?.length) extra.push(['可见角色', page.roles.map(role => roleNames[role] || role).join('、')]);
      if (extra.length) fields(mapping, extra);
      const overall = (design.positioning?.nfr_ids || []).map(id => nfrs.find(item => item.nfr_id === id)).filter(Boolean);
      if (overall.length) {
        mapping.append(element('h3', '整体体现'));
        const rows = element('ul', null, 'prototype-nfrs');
        overall.forEach(item => { const row = element('li'); row.append(element('strong', item.title), element('span', nfrCategories[item.category] || item.category, 'nfr-category'), element('p', item.prototype_treatment?.note || item.statement)); rows.append(row); });
        mapping.append(rows);
      }
    }
    for (const page of pages) {
      const button = element('button', null, 'selection-button'); button.type = 'button'; button.dataset.selectionKey = page.page_id;
      button.append(iconLabel(element('strong', page.name), 'documents'), element('span', [(page.requirement_ids || []).length ? page.requirement_ids.length + ' 条需求' : '', (page.nfr_ids || []).length ? page.nfr_ids.length + ' 条非功能' : ''].filter(Boolean).join(' · ')));
      button.addEventListener('click', () => { selectedPrototypePage = page.page_id; frame.contentWindow?.postMessage({type: 'prototype:go', page_id: page.page_id}, '*'); drawMapping(); });
      list.append(button);
    }
    const listener = event => {
      if (!frame.isConnected) { window.removeEventListener('message', listener); return; }
      if (event.source !== frame.contentWindow || event.data?.type !== 'prototype:page' || !pages.some(page => page.page_id === event.data.page_id)) return;
      if (selectedPrototypePage !== event.data.page_id) { selectedPrototypePage = event.data.page_id; drawMapping(); }
    };
    window.addEventListener('message', listener);
    side.append(frame);
    layout.append(list, side, mapping);
    content.append(layout);
    drawMapping();
    const excluded = design.excluded_requirements || [];
    const skipped = confirmedNfrs.filter(item => item.prototype_treatment?.kind === 'not_applicable');
    if (excluded.length || skipped.length) {
      const card = panel('不在原型中');
      const rows = element('ul', null, 'prototype-nfrs');
      excluded.forEach(item => { const row = element('li'); row.append(element('strong', requirements.find(req => req.requirement_id === item.requirement_id)?.title || item.requirement_id), element('span', '功能需求', 'nfr-category'), element('p', item.reason)); rows.append(row); });
      skipped.forEach(item => { const row = element('li'); row.append(element('strong', item.title), element('span', nfrCategories[item.category] || item.category, 'nfr-category'), element('p', item.prototype_treatment.note)); rows.append(row); });
      card.append(rows); content.append(card);
    }
  }
  function prototype() {
    const artifact = data.artifacts.find(item => item.path === 'prototype/index.html');
    if (artifact && project.prototype_design?.pages?.length) { designedPrototype(artifact); return; }
    if (artifact) { artifactPreviews('prototype/', '暂无原型'); return; }
    prototypeChecklist();
  }
  function database() {
    if (data.artifacts.some(item => item.path.startsWith('data-model/') && item.path.endsWith('.html'))) {
      artifactPreviews('data-model/', '交互式 ERD 待生成');
      return;
    }
    const model = project.business_model;
    const entities = Array.isArray(model.entities) ? model.entities : [];
    if (!entities.length) { content.append(empty('业务数据模型待整理')); return; }
    const identity = entity => entity.entity_id || entity.name;
    const entitiesById = new Map(entities.map(entity => [identity(entity), entity]));
    const current = entitiesById.get(selectedEntity) || entities[0];
    selectedEntity = identity(current);
    const links = Array.isArray(model.relations) ? model.relations.filter(link => entitiesById.has(link?.from) && entitiesById.has(link?.to)) : [];
    const map = panel('业务实体关系', 'technical');
    map.classList.add('entity-map');
    const choices = element('nav', null, 'module-filters'); choices.setAttribute('aria-label', '选择业务实体');
    const select = key => {
      selectedEntity = key; render();
      content.querySelector('.entity-map [aria-pressed="true"]')?.focus();
    };
    for (const entity of entities) {
      const choice = element('button', entity.name || identity(entity), 'module-filter'); choice.type = 'button';
      choice.setAttribute('aria-pressed', String(entity === current));
      choice.addEventListener('click', () => select(identity(entity)));
      choices.append(choice);
    }
    map.append(choices);
    const graph = element('div', null, 'entity-graph');
    const entityNode = (entity, isCurrent = false) => {
      const node = element('div', null, 'entity-node');
      if (isCurrent) node.classList.add('entity-node-current');
      const name = entity.name || identity(entity);
      if (isCurrent) node.append(element('strong', name));
      else {
        const button = element('button', name, 'source-link'); button.type = 'button';
        button.addEventListener('click', () => select(identity(entity))); node.append(button);
      }
      const fields = element('ul');
      if (Array.isArray(entity.fields)) entity.fields.slice(0, 4).forEach(field => fields.append(element('li', field.name || field.field_id)));
      node.append(fields);
      return node;
    };
    graph.append(entityNode(current, true));
    const relations = element('ul', null, 'entity-neighbours');
    for (const link of links.filter(item => item.from === selectedEntity || item.to === selectedEntity)) {
      const outgoing = link.from === selectedEntity;
      const destination = entitiesById.get(outgoing ? link.to : link.from);
      const branch = element('li', null, 'entity-branch');
      const direction = element('span', null, 'entity-edge');
      direction.append(element('span', link.label || (link.kind === 'foreign_key' && link.database_evidence ? '外键' : '逻辑关联')),
        element('span', outgoing ? '→' : '←', 'entity-edge-arrow'), element('small', link.cardinality || '关系基数待确认'));
      branch.append(direction, entityNode(destination)); relations.append(branch);
    }
    if (relations.childElementCount) graph.append(relations);
    map.append(graph); content.append(map);

    const detail = panel(current.name || selectedEntity);
    if (current.description) detail.append(element('p', current.description, 'material-metadata'));
    if (Array.isArray(current.fields) && current.fields.length) detail.append(dataTable(current.fields.map(field => {
      const {name, field_id, ...definition} = field;
      return [name || field_id, definition];
    })));
    else detail.append(empty('实体字段待确认'));
    requirements.filter(req => current.requirement_ids?.includes(req.requirement_id)).forEach(req => detail.append(requirementLink(req)));
    content.append(detail);
  }
  function api() {
    const apis = (project.apis || []).filter(matches);
    if (!apis.length) { content.append(empty('暂无接口设计：本次分析没有整理接口草案。需要时让 Skill 按已确认需求补充 apis，并标为草案')); return; }
    for (const item of apis) {
      const card = panel(item.name || item.api_id, 'technical');
      card.classList.add('api-spec');
      const endpoint = element('div', null, 'api-endpoint');
      const state = element('span', states[item.review_status] || item.review_status, 'api-status');
      endpoint.append(element('span', display(item.method), 'api-method'), element('code', display(item.path)), state);
      card.append(endpoint);
      const parts = element('div', null, 'api-parts');
      for (const [caption, data, marker] of [['请求', item.request, 'external'], ['响应', item.response, 'back'], ['异常', item.errors, 'pending']]) {
        const block = element('section');
        block.append(iconLabel(element('h3', caption), marker), valueNode(data)); parts.append(block);
      }
      card.append(parts);
      const related = requirements.filter(req => item.requirement_ids?.includes(req.requirement_id));
      if (related.length) {
        const links = element('div', null, 'api-related');
        links.append(iconLabel(element('h3', '关联需求'), 'modules'), ...related.map(requirementLink)); card.append(links);
      }
      content.append(card);
    }
  }
  function reviewForm(host = content, phase = 'definition') {
    const section = panel('记录评审意见', 'edit');
    section.classList.add('review-editor');
    if (!serverState) {
      section.append(element('p', '当前为只读分享版，评审意见请在本机工作台中记录。', 'inline-note'));
      host.append(section);
      return;
    }
    const form = element('form', null, 'intake-form review-opinion-form');
    const stage = element('select'); stage.id = 'review-stage';
    for (const [value, title] of [['definition', '需求定义'], ['release', '客户发布']]) { const option = element('option', title); option.value = value; stage.append(option); }
    stage.value = phase;
    const target = element('select'); target.id = 'review-target';
    let targets;
    function fillTargets() {
      targets = new Set(stage.value === 'release' ? data.artifacts.filter(item => item.path.startsWith('prototype/') && item.path.endsWith('.html')).map(item => item.path) : [...requirements.map(item => item.requirement_id), ...data.review.questions.map(item => item.target)]);
      target.replaceChildren();
      targets.forEach(value => { const req = requirements.find(item => item.requirement_id === value); const option = element('option', req ? req.title : nfrTitle(value) || value); option.value = value; target.append(option); });
      if (reviewTarget && targets.has(reviewTarget)) target.value = reviewTarget;
    }
    fillTargets(); stage.addEventListener('change', () => { fillTargets(); save.disabled = !targets.size; });
    const outcome = element('select'); outcome.id = 'review-outcome';
    for (const [value, label] of [['needs_changes', '需要修改'], ['confirmed', '确认此项'], ['parked', '暂缓']]) { const option = element('option', label); option.value = value; outcome.append(option); }
    const reviewer = element('input'); reviewer.id = 'review-author'; reviewer.maxLength = 200;
    const comment = element('textarea'); comment.id = 'review-comment'; comment.rows = 3; comment.maxLength = 10000;
    const updateOutcome = () => { outcome.dataset.outcome = outcome.value; };
    outcome.addEventListener('change', updateOutcome);
    updateOutcome();
    for (const [input, title, marker] of [...(phase === 'release' ? [[target, '评审对象', 'prototype']] : []), [outcome, '结论', 'decided'], [reviewer, '记录人（选填）', 'actors'], [comment, '意见', 'edit']]) {
      const field = element('div', null, 'review-field'); field.dataset.field = input.id;
      const label = iconLabel(element('label', title), marker); label.htmlFor = input.id;
      field.append(label, input === target || input === outcome ? selectControl(input) : input);
      form.append(field);
    }
    const save = iconLabel(element('button', '保存意见', 'button primary'), 'decided'); save.type = 'submit'; save.disabled = !targets.size;
    const revision = serverState.review.revision;
    form.addEventListener('submit', async event => {
      event.preventDefault(); save.disabled = true;
      try {
        const result = await localRequest('/api/review', {method: 'POST', body: JSON.stringify({revision, review_stage: stage.value, target: target.value, outcome: outcome.value, comment: comment.value, reviewer: reviewer.value})});
        serverState.review = result.review;
        reviewMessage = '意见已保存，绑定当前版本。通过 Skill 修订后生成新的需求和成果版本。';
        render();
      } catch (error) { reviewMessage = error.message; message.textContent = reviewMessage; save.disabled = false; }
    });
    const message = element('p', reviewMessage, 'inline-note'); message.setAttribute('role', 'status');
    form.append(save, message); section.append(form);
    const recordActions = element('div', null, 'review-record-actions');
    const refresh = iconLabel(element('button', '刷新记录', 'button small'), 'refresh');
    refresh.type = 'button';
    refresh.addEventListener('click', async () => {
      try { await refreshLocal(); render(); } catch (error) { message.textContent = error.message; }
    });
    recordActions.append(refresh);
    const records = serverState.review.decisions;
    if (records.length) {
      const exportButton = iconLabel(element('button', '导出评审记录', 'button small'), 'download');
      exportButton.type = 'button';
      exportButton.addEventListener('click', () => downloadJson({project_id: project.project_id, artifact_version: project.artifact_version, ...serverState.review, review_stage: stage.value, decisions: serverState.review.decisions.filter(item => (item.review_stage || 'definition') === stage.value)}, 'review-notes.json'));
      recordActions.append(exportButton);
    }
    section.append(recordActions);
    if (phase === 'release') { host.append(section); return; }
    const apply = element('form', null, 'intake-form review-apply-form');
    const label = iconLabel(element('label', '评审后的目标版本'), 'history'); label.htmlFor = 'review-version';
    const version = element('input'); version.id = 'review-version'; version.value = nextVersion(); version.required = true;
    const submit = iconLabel(element('button', '应用意见与修订', 'button'), 'history'); submit.type = 'submit'; submit.disabled = workflowBusy || (!records.some(item => (item.review_stage || 'definition') === 'definition') && !pendingChanges.length);
    apply.append(label, version, submit);
    for (const change of pendingChanges) {
      const row = element('div', null, 'inbox-row');
      const value = change.field === 'locked_fields' && !change.value.length ? '无锁定字段' : change.value;
      fields(row, [['需求', change.target], ['修改字段', change.field], ['新内容', value]]);
      apply.append(row);
    }
    apply.addEventListener('submit', event => {
      event.preventDefault(); const targetVersion = version.value; const changes = pendingChanges.slice(); const revision = serverState.review.revision;
      workflowAction(async () => {
        const result = await localRequest('/api/review/apply', {method: 'POST', body: JSON.stringify({version: targetVersion, revision, changes})});
        pendingChanges = []; return result;
      });
    });
    section.append(apply);
    if (workflowMessage) section.append(element('p', workflowMessage, 'inline-note'));
    (serverState.tasks || []).filter(task => task.kind === 'review' && task.status === 'completed').forEach(task => {
      const link = element('a', '打开修订版本 ' + task.version, 'button'); link.href = '/versions/' + task.id + '/workbench/index.html'; link.target = '_blank'; link.rel = 'noopener'; section.append(link);
    });
    host.append(section);
  }
  function releasePanel() {
    if (!serverState) return;
    const card = panel('客户交付');
    const files = data.artifacts.filter(item => item.path.startsWith('prototype/') && item.path.endsWith('.html'));
    if (files.length) {
      const form = element('form', null, 'intake-form');
      const choices = [];
      for (const file of files) {
        const label = element('label', null, 'workflow-check');
        const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.checked = true; checkbox.disabled = workflowBusy;
        label.append(checkbox, element('span', file.path)); form.append(label); choices.push([file.path, checkbox]);
      }
      const submit = iconLabel(element('button', '生成客户交付包', 'button primary'), 'package'); submit.type = 'submit'; submit.disabled = workflowBusy;
      form.append(submit);
      form.addEventListener('submit', event => {
        event.preventDefault(); const selected = choices.filter(([, checkbox]) => checkbox.checked).map(([path]) => path); const revision = serverState.review.revision;
        workflowAction(() => localRequest('/api/release', {method: 'POST', body: JSON.stringify({files: selected, revision})}));
      });
      card.append(form, element('p', '先在客户发布阶段复核选定原型。交付包可用于静态部署，部署结果另行记录。', 'inline-note'));
    } else card.append(element('p', '当前版本尚无可交付原型'));
    if (workflowMessage) card.append(element('p', workflowMessage, 'inline-note'));
    for (const release of serverState.releases || []) {
      const row = element('section', null, 'inbox-row delivery-package');
      row.append(iconLabel(element('h3', release.artifact_version + ' · 客户交付包'), 'package'));
      const preview = iconLabel(element('a', '预览客户包', 'button small'), 'external'); preview.href = '/customer/' + release.release_id + '/index.html'; preview.target = '_blank'; preview.rel = 'noopener';
      const download = iconLabel(element('a', '下载 ZIP', 'button small'), 'download'); download.href = '/api/releases/' + release.release_id + '/package'; download.download = project.project_id + '-' + release.artifact_version + '.zip';
      const actions = element('div', null, 'document-actions'); actions.append(preview, download);
      row.append(actions); card.append(row);
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
    const tabs = sectionTabs([
      ['questions', '负责人复核', 'edit'], ['customer', '客户复核', 'actors'], ['records', '已记录', 'review'],
      ['changes', '版本变更', 'history'], ['delivery', '交付', 'package'],
    ], reviewTab, '评审内容', key => { reviewTab = key; render(); });
    tabs.classList.add('review-tabs');
    content.append(tabs);
    if (reviewTab === 'customer') { customerReview(); return; }
    if (reviewTab === 'delivery') { releasePanel(); reviewForm(content, 'release'); return; }
    if (reviewTab === 'records') {
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
      if (!seen.size) content.append(empty('暂无评审记录'));
      return;
    }
    if (reviewTab === 'changes') {
      const card = panel('版本变更');
      fields(card, [['当前版本', project.artifact_version], ['上一版本', project.baseline_version]]);
      const changes = data.diff?.changes || [];
      for (const change of changes) {
        const req = requirements.find(item => item.requirement_id === change.target);
        const row = element('section', null, 'inbox-row'); row.append(element('h3', req?.title || change.target));
        fields(row, [['字段', change.field], ['修改前', change.old], ['修改后', change.new]]); card.append(row);
      }
      for (const conflict of data.diff?.conflicts || []) {
        const row = element('section', null, 'inbox-row'); row.append(element('h3', '需要核对的修改'));
        fields(row, [['对象', conflict.target], ['字段', conflict.field], ['保留内容', conflict.retained], ['建议内容', conflict.proposed]]); card.append(row);
      }
      if (!changes.length && !data.diff?.conflicts?.length) card.append(element('p', '本版没有内容变更', 'inline-note'));
      content.append(card); return;
    }
    const targets = [...new Set([...requirements.map(req => req.requirement_id), ...data.review.questions.map(question => question.target)])];
    const groups = targets.map(target => {
      const req = requirements.find(item => item.requirement_id === target);
      const issues = data.review.questions.filter(question => question.target === target);
      const specific = [...new Set(issues.map(issue => issue.reason))].filter(reason => reason !== '核对依据、范围与确认状态');
      return {key: target, marker: req ? 'modules' : 'documents', title: req?.title || nfrTitle(target) || ({business_model: '业务模型', pages: '页面定义', requirements: '功能需求'}[target] || (target.startsWith('requirement_profile.') ? '项目背景与范围' : target)), meta: specific.length ? specific.length + ' 个问题' : '', req, issues, specific};
    }).filter(group => (group.specific.length || group.key === reviewTarget) && matches([group.title, group.key, group.issues]));
    const current = groups.find(group => group.key === reviewTarget) || groups[0];
    if (!current) { content.append(empty(queryInput.value.trim() ? '没有匹配的评审事项' : '没有需要确认的问题')); return; }
    reviewTarget = current.key;
    const detail = selectionLayout(groups, current.key, '评审事项', key => { reviewTarget = key; reviewMessage = ''; });
    detail.parentElement.classList.add('review-workspace');
    const card = panel(current.title, 'pending');
    card.classList.add('review-pending-card');
    const reasons = [...new Set(current.issues.map(issue => issue.reason))];
    const specific = reasons.filter(reason => reason !== '核对依据、范围与确认状态');
    const shown = specific.length ? specific : reasons;
    if (shown.length) {
      const list = element('ul', null, 'review-issues');
      shown.forEach(reason => list.append(iconLabel(element('li', reason), 'pending')));
      card.append(list);
    }
    else card.append(element('p', '核对功能、范围与验收标准', 'inline-note'));
    if (current.req) {
      const button = iconLabel(element('button', '查看需求和原话 →', 'source-link'), 'quote'); button.type = 'button';
      button.addEventListener('click', () => openRequirement(current.req)); card.append(button);
    }
    detail.append(card); reviewForm(detail);
  }
  function technical() {
    const tabs = {diagrams: '技术架构', database: '数据模型', api: '接口'};
    const navigation = element('div', null, 'technical-tabs');
    navigation.setAttribute('role', 'tablist');
    navigation.setAttribute('aria-label', '技术设计分类');
    const panelNode = element('section');
    panelNode.id = 'technical-panel';
    panelNode.setAttribute('role', 'tabpanel');
    panelNode.setAttribute('aria-labelledby', 'tab-' + technicalTab);
    content.append(navigation, panelNode);
    for (const [key, label] of Object.entries(tabs)) {
      const button = iconLabel(element('button', label, 'button ghost small'), {diagrams: 'technical', database: 'database', api: 'api'}[key]);
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
    const searchLabels = {materials: '搜索素材或会议原话', modules: '搜索需求、规则或依据', review: '搜索评审问题', technical: '搜索接口草案'};
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
