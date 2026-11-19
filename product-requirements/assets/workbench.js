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
  let technicalTab = 'diagrams';
  let selectedArchitecture = null;
  let selectedMaterial = null;
  let selectedModule = null;
  let moduleView = data.module_diagram ? 'map' : 'list';
  let selectedRequirement = null;
  let moduleDetailTab = 'requirements';
  let requirementTab = 'detail';
  let moduleFrame = null;
  let selectDiagramModule = null;
  const requestedDocument = new URLSearchParams(location.search).get('document');
  let selectedDocument = ['proposal.md', 'prd.md'].includes(requestedDocument) ? requestedDocument : 'proposal.md';
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
    for (const [key, title] of items) {
      const button = element('button', title);
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
  function panel(title) {
    const section = element('section', null, 'panel requirement-card');
    section.append(element('h2', title));
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
    return link;
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
      button.append(element('strong', item.title), element('span', item.meta));
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
  function requirementLink(req) {
    const button = element('button', req.title, 'source-link');
    button.dataset.requirementId = req.requirement_id;
    button.title = '需求编号 ' + req.requirement_id;
    button.type = 'button';
    button.addEventListener('click', () => {
      queryInput.value = req.requirement_id;
      requirementTab = 'detail';
      moduleDetailTab = 'requirements';
      statusInput.value = '';
      evidenceInput.value = '';
      selectedModule = null;
      navigate('modules');
    });
    return button;
  }
  function sourceLink(sourceId) {
    const source = sourceMap.get(sourceId);
    const button = element('button', '查看原话 · ' + locatorLabel(source?.locator || {}), 'source-link');
    button.type = 'button';
    button.dataset.sourceRef = sourceId;
    button.addEventListener('click', () => {
      selectedSource = sourceId;
      queryInput.value = '';
      materialTab = 'library';
      materialReader = 'transcript';
      materialQuery = '';
      navigate('materials');
    });
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
    const submit = element('button', '加入修订草稿', 'button'); submit.type = 'submit';
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
  function requirementCard(req) {
    const card = panel(req.title);
    card.classList.add('requirement-inspector');
    const identity = element('div', null, 'requirement-identity');
    identity.append(element('span', '需求编号 ' + req.requirement_id));
    badges(identity, [states[req.review_status], evidenceNames[req.evidence_type]]);
    card.append(identity);
    const body = element('div', null, 'requirement-tab-body');
    const tabs = [['detail', '功能'], ['rules', '规则'], ['sources', '会议原话']];
    if (serverState) tabs.push(['edit', '修改']);
    const selected = tabs.some(([key]) => key === requirementTab) ? requirementTab : 'detail';
    const navigation = sectionTabs(tabs, selected, '需求详情', show);
    function show(key) {
      requirementTab = key;
      navigation.querySelectorAll('button').forEach((button, index) => button.setAttribute('aria-pressed', String(tabs[index][0] === key)));
      body.replaceChildren();
      if (key === 'edit') body.append(requirementEditor(req));
      else if (key === 'sources') {
        for (const sourceId of req.source_refs) {
          const source = sourceMap.get(sourceId);
          body.append(sourceLink(sourceId), element('blockquote', source?.text || '来源待补充', 'source-quote'));
        }
      } else if (key === 'rules') {
        const known = [['使用者', req.role], ['触发条件', req.trigger], ['输入', req.inputs], ['输出', req.outputs], ['业务规则', req.rules], ['异常处理', req.exceptions]].filter(([, value]) => display(value) !== '待确认');
        if (known.length) fields(body, known);
        else body.append(element('p', '业务规则待补充', 'inline-note'));
      } else {
        body.append(element('h3', '功能内容'), valueNode(req.behavior));
        body.append(element('h3', '验收标准'), valueNode(req.acceptance_criteria));
        if (req.open_questions?.length) {
          body.append(element('h3', '需要确认'), valueNode(req.open_questions));
        }
      }
    }
    const reviewButton = element('button', '记录评审意见', 'button ghost small');
    reviewButton.type = 'button';
    reviewButton.addEventListener('click', () => { reviewTarget = req.requirement_id; reviewTab = 'questions'; navigate('review'); });
    card.append(navigation, body, reviewButton);
    show(selected);
    return card;
  }
  function needsDefinitionReview() {
    const activeRequirements = requirements.filter(req => req.review_status !== 'parked' && req.lifecycle_status !== 'cancelled');
    return !activeRequirements.length || activeRequirements.some(req => req.review_status !== 'confirmed' || !req.acceptance_criteria);
  }
  function overview() {
    const definition = panel(project.name || project.project_id);
    definition.classList.add('project-definition');
    const next = element('div', null, 'next-action');
    next.append(element('span', '下一步'));
    const action = element('button', null, 'button small primary');
    action.id = 'next-action'; action.type = 'button';
    const needsReview = needsDefinitionReview();
    const prototypeAvailable = data.artifacts.some(item => item.path.startsWith('prototype/') && item.path.endsWith('.html'));
    if (!requirements.length) {
      action.textContent = '导入会议';
      action.addEventListener('click', () => { materialTab = 'import'; navigate('materials'); });
    } else if (needsReview) {
      action.textContent = '核对需求';
      action.addEventListener('click', () => { moduleView = 'list'; navigate('modules'); });
    } else {
      action.textContent = prototypeAvailable ? '查看原型' : '查看方案';
      action.addEventListener('click', () => navigate(prototypeAvailable ? 'prototype' : 'documents'));
    }
    next.append(action);
    definition.append(element('p', display(project.summary || project.requirement_profile.desired_outcomes), 'project-objective'));
    fields(definition, [['面向', project.requirement_profile.customer_and_roles], ['范围', project.requirement_profile.scope]]);
    const flow = project.business_model.flows?.[0];
    if (flow?.steps?.length) {
      const steps = element('ol', null, 'overview-flow');
      steps.setAttribute('aria-label', flow.name || '核心流程');
      flow.steps.forEach(step => steps.append(element('li', step.label)));
      definition.append(steps);
    }
    content.append(definition);
    const grid = element('div', null, 'overview-sections');
    const outputs = panel('当前版本 · ' + project.artifact_version);
    outputs.append(element('p', !requirements.length ? '会议材料尚未整理' : needsReview ? '需求核对中' : prototypeAvailable ? '原型已就绪，等待评审' : '需求已核对，尚无原型', 'version-summary'));
    for (const [view, label, prefixes] of [['documents', '方案文档', []], ['modules', '功能需求', []], ['prototype', '原型预览', ['prototype/']], ['technical', '技术设计', ['diagrams/', 'data-model/']]]) {
      const available = !prefixes.length || data.artifacts.some(item => prefixes.some(prefix => item.path.startsWith(prefix)) && item.path.endsWith('.html'));
      const row = element('button', null, 'output-row');
      row.type = 'button';
      row.append(element('strong', label), element('span', available ? '查看 →' : '暂无 →'));
      row.addEventListener('click', () => navigate(view));
      outputs.append(row);
    }
    const questions = panel('接下来');
    questions.append(next);
    const explicit = requirements.flatMap(req => (req.open_questions || []).map(reason => ({target: req.requirement_id, reason})));
    const candidates = explicit.length ? explicit : data.review.questions;
    const unique = candidates.filter((question, index) => candidates.findIndex(item => item.reason === question.reason) === index);
    unique.slice(0, 3).forEach(question => {
      const button = element('button', question.reason, 'question-row');
      button.type = 'button';
      button.addEventListener('click', () => {
        const req = requirements.find(item => item.requirement_id === question.target);
        if (req) { selectedRequirement = req.requirement_id; queryInput.value = req.requirement_id; statusInput.value = ''; evidenceInput.value = ''; navigate('modules'); }
        else { reviewTab = 'questions'; navigate('review'); }
      });
      questions.append(button);
    });
    if (!unique.length) questions.append(element('p', '等待人工核对当前成果', 'inline-note'));
    const all = element('button', '查看全部评审事项 →', 'source-link');
    all.type = 'button'; all.addEventListener('click', () => { reviewTab = 'questions'; navigate('review'); });
    questions.append(all);
    grid.append(outputs, questions);
    content.append(grid);
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
    const card = panel('导入素材');
    if (!serverState) {
      card.append(element('p', '使用本地运行器后，可导入录音、录屏、逐字稿或飞书妙记。当前版本的资料可继续浏览。', 'inline-note'));
      if (intakeMessage) card.append(element('p', intakeMessage, 'inline-note'));
      content.append(card);
      return;
    }
    const form = element('form', null, 'intake-form');
    const label = element('label', '录音、录屏或逐字稿');
    label.htmlFor = 'material-file';
    const files = element('input');
    files.id = 'material-file';
    files.type = 'file';
    files.multiple = true;
    files.accept = '.txt,.md,.srt,.vtt,.mp3,.wav,.m4a,.aac,.ogg,.flac,.mp4,.mov,.webm,.mkv';
    files.disabled = intakeBusy;
    const recordingLabel = element('label', '逐字稿关联录音（可选）');
    recordingLabel.htmlFor = 'related-recording';
    const recording = element('select'); recording.id = 'related-recording';
    const independent = element('option', '独立素材'); independent.value = ''; recording.append(independent);
    serverState.jobs.filter(job => job.kind === 'recording').forEach(job => { const option = element('option', job.name); option.value = job.job_id; recording.append(option); });
    recording.disabled = intakeBusy;
    const submit = element('button', '导入文件', 'button primary');
    submit.type = 'submit';
    submit.disabled = intakeBusy;
    form.append(label, files, element('p', '每个文件最大 256 MB。逐字稿生成来源片段，音视频提取音轨后等待转写。', 'inline-note'), recordingLabel, recording, submit);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const selected = Array.from(files.files);
      if (!selected.length) { intakeMessage = '请先选择文件'; render(); return; }
      const relatedJob = recording.value;
      importAction(async () => {
        for (const file of selected) {
          if (file.size > serverState.max_upload_bytes) throw new Error(file.name + ' 超过文件大小限制');
          const result = await localRequest('/api/import?filename=' + encodeURIComponent(file.name) + (relatedJob ? '&related_job=' + encodeURIComponent(relatedJob) : ''), {method: 'POST', body: file});
          if (result.job.status === 'failed') throw new Error(result.job.error || '预处理失败，原始材料已保留');
        }
      });
    });
    const connector = element('section', null, 'inbox-row');
    connector.append(element('h3', '飞书妙记'));
    const feishu = element('form', null, 'intake-form');
    const urlLabel = element('label', '妙记链接');
    urlLabel.htmlFor = 'minutes-url';
    const url = element('input');
    url.id = 'minutes-url';
    url.type = 'url';
    url.required = true;
    url.placeholder = 'https://…feishu.cn/minutes/…';
    const mode = element('select');
    mode.setAttribute('aria-label', '获取内容');
    for (const [value, text] of [['transcript', '逐字稿'], ['media', '原始音视频']]) {
      const option = element('option', text); option.value = value; mode.append(option);
    }
    const connect = element('button', '获取素材', 'button');
    connect.type = 'submit';
    connect.disabled = intakeBusy || !serverState.lark_cli_available;
    feishu.append(urlLabel, url, mode, connect);
    feishu.addEventListener('submit', event => {
      event.preventDefault();
      const minutes = url.value;
      const media = mode.value === 'media';
      importAction(() => localRequest('/api/feishu', {method: 'POST', body: JSON.stringify({minutes, media})}));
    });
    connector.append(feishu, element('p', '使用本机飞书账号读取所选妙记，需已有访问及导出权限。', 'inline-note'));
    card.append(form, connector);
    if (intakeBusy) { const progress = element('progress'); progress.setAttribute('aria-label', '素材预处理中'); card.append(progress); }
    if (intakeMessage) { const message = element('p', intakeMessage, 'inline-note'); message.setAttribute('role', 'status'); card.append(message); }
    content.append(card);
    const jobs = panel('接收箱');
    const labels = {ready_for_analysis: '待 Skill 分析', awaiting_transcript: '等待转写', failed: '处理失败', processing: '处理中'};
    for (const job of serverState.jobs) {
      const row = element('section', null, 'inbox-row');
      row.append(element('h3', job.name));
      const analysis = analysisFor(job);
      const analysisLabels = {waiting_host: '等待宿主分析', running: '分析执行中', failed: '分析失败', completed: '已生成分析版本'};
      const statusLabel = analysis ? analysisLabels[analysis.status] : job.status === 'awaiting_transcript' && hasTranscript(job) ? '已有转写' : labels[job.status] || job.status;
      badges(row, [statusLabel, job.kind === 'recording' ? '音视频' : '逐字稿', job.source_count ? job.source_count + ' 段原话' : job.stage]);
      if (job.provenance.related_job_id) row.append(element('p', '关联录音 · ' + (serverState.jobs.find(item => item.job_id === job.provenance.related_job_id)?.name || job.provenance.related_job_id), 'inline-note'));
      if (job.error) row.append(element('p', job.error, 'inline-note'));
      const actions = element('div', null, 'document-actions');
      for (const [key, label] of [['original', '原始素材'], ['sources', '来源片段'], ['analysis_request', '分析请求']]) if (job.files[key]) actions.append(jobLink(job, key, label));
      if (job.status === 'awaiting_transcript') {
        const linked = serverState.jobs.find(item => item.provenance.related_job_id === job.job_id && item.status === 'ready_for_analysis');
        if (linked) row.append(element('p', '已有关联逐字稿 · ' + linked.name, 'inline-note'));
        else {
          const asr = element('button', '使用已配置转写服务', 'button'); asr.type = 'button'; asr.disabled = intakeBusy || !serverState.asr_configured;
          asr.addEventListener('click', () => importAction(() => localRequest('/api/transcribe', {method: 'POST', body: JSON.stringify({job_id: job.job_id})}))); actions.append(asr);
        }
      }
      if (job.status === 'failed') {
        const retry = element('button', '重试预处理', 'button');
        retry.type = 'button'; retry.disabled = intakeBusy;
        retry.addEventListener('click', () => importAction(() => localRequest('/api/retry', {method: 'POST', body: JSON.stringify({job_id: job.job_id})})));
        actions.append(retry);
      }
      row.append(actions);
      const mediaKey = /\.(mp4|mov|webm|mkv)$/i.test(job.files.original || '') ? 'original' : job.files.audio ? 'audio' : 'original';
      const path = job.files[mediaKey];
      if (job.kind === 'recording' && path && job.status !== 'failed') {
        const player = element(/\.(mp4|mov|webm|mkv)$/i.test(path) ? 'video' : 'audio');
        player.controls = true;
        player.preload = 'none';
        player.src = '/api/jobs/' + job.job_id + '/' + mediaKey;
        row.append(player);
      }
      jobs.append(row);
    }
    if (!serverState.jobs.length) jobs.append(element('p', '导入后的素材将在这里显示'));
    const refresh = element('button', '刷新接收箱', 'button');
    refresh.type = 'button';
    refresh.disabled = intakeBusy;
    refresh.addEventListener('click', async () => {
      try { await refreshLocal(); render(); } catch (error) { intakeMessage = error.message; render(); }
    });
    jobs.append(refresh);
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
  function processingFlow() {
    const card = panel('素材处理流程');
    if (!serverState?.jobs.length) { card.append(empty('暂无处理中的素材')); content.append(card); return; }
    for (const job of serverState.jobs) {
      const relatedJobs = [job.job_id, ...serverState.jobs.filter(item => item.provenance?.related_job_id === job.job_id).map(item => item.job_id)];
      const task = (serverState.tasks || []).filter(item => item.kind === 'analysis' && (item.job_ids || []).some(id => relatedJobs.includes(id))).at(-1);
      const transcriptReady = job.status === 'ready_for_analysis' || hasTranscript(job);
      const failed = job.status === 'failed';
      const row = element('section', null, 'processing-item'); row.append(element('h3', job.name));
      const steps = element('ol', null, 'processing-flow'); steps.setAttribute('aria-label', job.name + '处理流程');
      const values = [
        ['接收', failed ? '处理失败' : '已接收'],
        ['转写', transcriptReady ? '已就绪' : failed ? '未开始' : '等待转写'],
        ['需求分析', task?.status === 'completed' ? '已完成' : task?.status === 'running' ? '分析中' : task?.status === 'failed' ? '分析失败' : task ? '等待分析' : '未开始'],
        ['工作台', task?.status === 'completed' ? '可查看' : '未就绪']
      ];
      values.forEach(([title, status], index) => {
        const step = element('li'); step.append(element('strong', title), element('span', status));
        if (index === 3 && task?.status === 'completed') { const link = element('a', '打开 →', 'source-link'); link.href = '/versions/' + task.id + '/workbench/index.html'; step.append(link); }
        steps.append(step);
      });
      row.append(steps); if (job.error || task?.error) row.append(element('p', job.error || task.error, 'inline-note')); card.append(row);
    }
    content.append(card);
  }
  function analysisPanel() {
    if (!serverState) return;
    const card = panel('需求分析');
    const form = element('form', null, 'intake-form');
    const choices = [];
    const present = new Set((project.materials || []).map(item => item.material_id));
    for (const job of serverState.jobs.filter(item => item.status === 'ready_for_analysis')) {
      const label = element('label', job.name);
      const select = element('select'); select.id = 'analysis-' + job.job_id; label.htmlFor = select.id;
      for (const [value, text] of [['skip', '跳过'], ['meeting', '会议材料'], ['context', '前情资料']]) { const option = element('option', text); option.value = value; select.append(option); }
      select.value = present.has(job.material_id) ? 'skip' : 'meeting';
      select.disabled = workflowBusy;
      choices.push([job.job_id, select]); form.append(label, select);
    }
    const versionLabel = element('label', '目标版本'); versionLabel.htmlFor = 'analysis-version';
    const version = element('input'); version.id = 'analysis-version'; version.value = nextVersion(); version.required = true; version.disabled = workflowBusy;
    const submit = element('button', '准备分析请求', 'button primary'); submit.type = 'submit'; submit.disabled = workflowBusy;
    form.append(versionLabel, version, submit);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const job_ids = choices.filter(([, choice]) => choice.value !== 'skip').map(([id]) => id);
      const context_job_ids = choices.filter(([, choice]) => choice.value === 'context').map(([id]) => id);
      const selectedVersion = version.value;
      workflowAction(() => localRequest('/api/analysis', {method: 'POST', body: JSON.stringify({job_ids, context_job_ids, version: selectedVersion})}));
    });
    card.append(form);
    if (workflowMessage) { const message = element('p', workflowMessage, 'inline-note'); message.setAttribute('role', 'status'); card.append(message); }
    const labels = {waiting_host: '等待宿主分析', running: '生成中', failed: '失败，可重试', completed: '已生成'};
    for (const task of (serverState.tasks || []).filter(item => item.kind === 'analysis').slice(-3)) {
      const row = element('section', null, 'inbox-row');
      row.append(element('h3', task.version + ' · ' + ({review: '评审修订', document: '文档修订', generation: '成果生成', analysis: '需求分析'}[task.kind] || task.kind)));
      badges(row, [labels[task.status] || task.status]);
      if (task.error) row.append(element('p', task.error, 'inline-note'));
      for (const result of task.generation_results || []) row.append(element('p', result.capability + ' · ' + (result.generation_status === 'success' ? '已生成' : result.error), 'inline-note'));
      if (task.status === 'completed') {
        const link = element('a', '打开新版本', 'button');
        link.href = '/versions/' + task.id + '/workbench/index.html'; link.target = '_blank'; link.rel = 'noopener'; row.append(link);
      } else {
        for (const [key, label] of [['request', '分析请求'], ['baseline', '原基线'], ['sources', '完整来源']]) {
          const link = element('a', label, 'button ghost small'); link.href = '/api/tasks/' + task.id + '/' + key; link.target = '_blank'; link.rel = 'noopener'; row.append(link);
        }
        if (task.kind === 'analysis' && task.status !== 'running') {
          if (serverState.analysis_configured) {
            const execute = element('button', '执行已配置宿主', 'button primary'); execute.type = 'button'; execute.disabled = workflowBusy;
            execute.addEventListener('click', () => workflowAction(() => localRequest('/api/analysis/execute', {method: 'POST', body: JSON.stringify({request_id: task.id})}))); row.append(execute);
          }
          const resultForm = element('form', null, 'intake-form');
          const label = element('label', '宿主返回的 project.json'); label.htmlFor = 'result-' + task.id;
          const file = element('input'); file.type = 'file'; file.accept = '.json'; file.required = true; file.id = label.htmlFor;
          const complete = element('button', '校验并生成新版本', 'button'); complete.type = 'submit'; complete.disabled = workflowBusy;
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
      }
      card.append(row);
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
    const visible = entries;
    const selected = visible.find(item => selectedSource && item.sources.some(source => source.source_id === selectedSource)) || visible.find(item => item.key === selectedMaterial) || visible[0];
    if (!selected) { content.append(empty('暂无匹配素材，可调整搜索词后查看')); return; }
    selectedMaterial = selected.key;
    const detail = selectionLayout(visible, selected.key, '会议素材列表', key => { selectedMaterial = key; selectedSource = null; materialPage = 0; materialReader = 'highlights'; materialQuery = ''; });
    const card = panel(selected.title);
    if (selected.context) {
      card.append(valueNode(selected.context));
      detail.append(card);
      return;
    }
    const meeting = selected.meetings[0];
    const highlights = (meeting?.highlights || []).filter(item => item.text && item.source_refs?.every(id => sourceMap.has(id)));
    const transcriptMode = materialReader === 'transcript' || selectedSource || materialQuery.trim() || !highlights.length;
    const metadata = [meeting?.date, meeting?.duration_label].filter(Boolean);
    if (metadata.length) card.append(element('p', metadata.join(' · '), 'material-metadata'));
    const actions = element('div', null, 'document-actions');
    const attached = data.attachments.find(item => item.material_id === selected.material?.material_id);
    if (attached) actions.append(fileLink(attached.path, selected.material?.kind === 'recording' ? '下载素材' : '下载逐字稿'));
    if (meeting?.url) {
      try {
        const url = new URL(meeting.url);
        if (url.protocol === 'https:' && (url.hostname === 'feishu.cn' || url.hostname.endsWith('.feishu.cn') || url.hostname.endsWith('.larksuite.com'))) {
          const link = element('a', '打开飞书妙记', 'button small');
          link.href = url.href; link.target = '_blank'; link.rel = 'noopener'; actions.append(link);
        }
      } catch { /* An invalid source URL is retained in project data. */ }
    }
    if (actions.children.length) card.append(actions);
    const readingTools = element('div', null, 'meeting-reading-tools');
    const search = element('input', null, 'meeting-search');
    search.id = 'meeting-search'; search.type = 'search'; search.placeholder = '搜索本次会议原话';
    search.setAttribute('aria-label', '搜索本次会议原话'); search.value = materialQuery;
    search.addEventListener('input', () => {
      const cursor = search.selectionStart;
      materialQuery = search.value; materialPage = 0; selectedSource = null;
      render();
      const current = document.getElementById('meeting-search');
      current.focus(); current.setSelectionRange(cursor, cursor);
    });
    card.append(readingTools);
    if (highlights.length) {
      readingTools.append(sectionTabs([['highlights', '会议重点'], ['transcript', '逐字稿']], transcriptMode ? 'transcript' : 'highlights', '会议阅读方式', key => { materialReader = key; selectedSource = null; materialPage = 0; materialQuery = ''; render(); }));
      readingTools.append(search);
      if (!transcriptMode) {
        const list = element('div', null, 'meeting-highlights');
        for (const highlight of highlights) {
          const row = element('section', null, 'meeting-highlight');
          row.append(element('p', highlight.text));
          for (const id of highlight.source_refs) {
            const button = sourceLink(id);
            button.textContent = locatorLabel(sourceMap.get(id).locator) + ' 查看原话 →';
            row.append(button);
          }
          list.append(row);
        }
        card.append(list);
        detail.append(card);
        return;
      }
    }
    if (!highlights.length) readingTools.append(search);
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
      card.append(player, seekMessage);
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
    if (pageCount > 1) card.append(paging);
    transcriptSources.slice(materialPage * 30, (materialPage + 1) * 30).forEach(source => {
      const excerpt = element('section', null, 'source-excerpt');
      if (source.source_id === selectedSource) excerpt.classList.add('source-selected');
      const speakerPrefix = /^([\p{Script=Han}]{2,8}|说话人\s*\d+|Speaker\s*\d+)[：:]\s*/u.exec(source.text);
      const speaker = source.speaker || speakerPrefix?.[1];
      badges(excerpt, [locatorLabel(source.locator), speaker || '说话人待确认']);
      excerpt.dataset.sourceId = source.source_id;
      excerpt.append(element('blockquote', speakerPrefix ? source.text.slice(speakerPrefix[0].length) : source.text, 'source-quote'));
      if (player && Number.isFinite(source.locator.start_seconds)) {
        const seek = element('button', '定位录音 ' + locatorLabel(source.locator), 'button small');
        seek.type = 'button';
        seek.dataset.sourceId = source.source_id;
        seek.addEventListener('click', () => {
          seekTarget = source.locator.start_seconds;
          if (player.readyState >= 1) applySeek();
          else { seekMessage.textContent = '正在加载录音时间信息…'; player.load(); }
        });
        excerpt.append(seek);
      }
      const linked = requirements.filter(req => req.source_refs.includes(source.source_id));
      linked.forEach(req => excerpt.append(requirementLink(req)));
      card.append(excerpt);
    });
    if (!transcriptSources.length) card.append(element('p', materialQuery.trim() ? '没有匹配的原话' : '当前素材尚无可定位的原话片段', 'inline-note'));
    detail.append(card);
    if (selectedSource) detail.querySelector('.source-selected')?.scrollIntoView?.({block: 'nearest'});
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
      const button = element('button', null, 'requirement-choice'); button.type = 'button';
      button.dataset.requirementId = req.requirement_id;
      button.title = '需求编号 ' + req.requirement_id;
      button.append(element('strong', req.title), element('span', states[req.review_status]));
      button.setAttribute('aria-pressed', String(req === current));
      button.addEventListener('click', () => {
        selectedRequirement = req.requirement_id; requirementTab = 'detail';
        moduleDetails(group, host); host.querySelector('.requirement-choice[aria-pressed="true"]')?.focus();
      });
      choices.append(button);
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
      if (reveal) detail.scrollIntoView?.({block: 'nearest'});
    }
    host.append(picker, detail);
    select(nodes.some(node => node.id === selectedArchitecture) ? selectedArchitecture : nodes[0].id);
    return {host, select};
  }
  function technicalArchitecture() {
    const architecture = project.technical_architecture;
    if (!architecture?.components?.length) { content.append(empty('技术架构待确认')); return; }
    if (data.architecture_diagram) {
      const card = panel('技术架构');
      if (architecture.review_status !== 'confirmed') card.append(element('span', '设计建议 · 待确认', 'workbench-meta'));
      card.append(fileLink('diagrams/architecture.html', '打开完整页面'));
      const frame = element('iframe', null, 'architecture-preview'); frame.title = 'Archify 技术架构'; frame.setAttribute('sandbox', 'allow-scripts');
      const details = architectureDetails(architecture, frame);
      const bridge = `(() => {
        const style = document.createElement('style'); style.textContent = 'html,body{background:#fdfefe;min-height:0 !important;margin:0;padding:0 !important} body > .toolbar,.container > .header,.diagram-nav,.reader-rail,.rail-reveal,#focus-chip,.cards{display:none !important} .container{padding:0;max-width:none} .diagram-container{padding:0;border:0;box-shadow:none;margin:0;min-height:0 !important} .diagram-container > svg{display:block;width:100%;height:auto;min-width:0 !important} svg [data-node-id] text.t-primary{font-size:20px} svg [data-node-id] text.t-muted{font-size:14px} svg [data-node-id] text.t-backend{font-size:10px;opacity:1 !important} [data-node-id]{cursor:pointer} [data-node-id][data-workbench-selected]{filter:drop-shadow(0 0 3px #2863d6)}'; document.head.append(style);
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
    for (const [view, label] of [['map', '功能模块'], ['usecases', '用例图'], ['list', '需求列表']]) {
      const button = element('button', label); button.type = 'button'; button.setAttribute('aria-pressed', String(moduleView === view));
      button.addEventListener('click', () => { moduleView = view; render(); content.querySelector('.view-switcher [aria-pressed="true"]')?.focus(); }); switcher.append(button);
    }
    tools.append(switcher, element('span', visible.length + ' / ' + requirements.length + ' 条需求', 'module-count'));
    content.append(tools);
    if (workflowMessage) content.append(element('p', workflowMessage, 'inline-note'));
    if (!selected) { content.append(empty('暂无匹配需求，可调整搜索词或筛选条件')); return; }
    selectedModule = selected.key;
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
      surface.querySelectorAll('[data-req-row]').forEach(row => row.setAttribute('aria-selected', String(selectedRequirement === row.dataset.reqRow)));
      if (reveal) detail.scrollIntoView?.({block: 'nearest'});
    }
    choices.forEach(group => {
      const button = element('button', null, 'module-filter'); button.type = 'button'; button.dataset.moduleKey = group.key;
      button.setAttribute('aria-current', String(group === selected)); button.append(element('span', group.title), element('span', group.items.length, 'module-filter-count'));
      button.addEventListener('click', () => select(group.key, true)); filters.append(button);
    });
    content.append(workspace); workspace.append(surface, filters, detail);
    if (moduleView === 'usecases') {
      surface.append(useCaseDiagram(choices, (key, requirement) => { selectedRequirement = requirement; select(key, true); }));
    } else if (moduleView === 'map' && data.module_diagram) {
      const head = element('div', null, 'module-surface-head'); head.append(element('h2', '业务模块'));
      head.append(fileLink('diagrams/modules.html', '独立打开')); surface.append(head);
      const frame = element('iframe', null, 'module-map'); frame.title = 'Archify 业务模块图'; frame.setAttribute('sandbox', 'allow-scripts');
      frame.style.height = Math.max(300, Math.ceil(project.modules.length / 3) * 160 + 120) + 'px';
      const bridge = `(() => {
        const style = document.createElement('style'); style.textContent = 'body {background:#fdfefe} body > .toolbar, .container > .header, .diagram-nav, .reader-rail, .rail-reveal, #focus-chip {display:none !important} .container {padding:0;max-width:none} .diagram-container {border:0;box-shadow:none;margin:0} .diagram-container > svg {min-width:0 !important} @media(max-width:480px){.diagram-container > svg {min-width:620px !important}} svg [data-node-id] text.t-primary {font-size:22px} svg [data-node-id] text.t-muted {font-size:16px} [data-node-id][data-workbench-selected] {filter:drop-shadow(0 0 3px #2863d6)} [data-node-id][data-workbench-filtered] {opacity:.22}'; document.head.append(style);
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
    } else {
      const scroll = element('div', null, 'data-table-scroll'); const table = element('table', null, 'data-table requirement-table');
      const head = element('thead'); const headings = element('tr'); ['需求', '状态', '模块'].forEach(label => headings.append(element('th', label))); head.append(headings); table.append(head);
      const body = element('tbody');
      visible.forEach(req => {
        const group = choices.find(item => item.items.includes(req));
        const row = element('tr'); row.dataset.reqRow = req.requirement_id;
        const cell = element('td'); const button = element('button', null, 'requirement-row-button'); button.type = 'button'; button.append(element('strong', req.title), element('span', '需求编号 ' + req.requirement_id, 'module-identity'));
        button.addEventListener('click', () => { selectedRequirement = req.requirement_id; requirementTab = 'detail'; select(group.key, true); }); cell.append(button);
        row.append(cell, element('td', states[req.review_status]), element('td', group.title)); body.append(row);
      });
      table.append(body); scroll.append(table); surface.append(scroll);
    }
    select(selectedModule);
  }
  function markdownDocument(text) {
    const body = element('div', null, 'document-body');
    let list = null;
    function paragraph(tag, text) {
      const node = element(tag);
      let offset = 0;
      for (const match of text.matchAll(/(?<!\\)\[([^\]]+)\]\((https:\/\/[^\s)]+|(?:prd|proposal)\.md)\)/g)) {
        node.append(document.createTextNode(unescape(text.slice(offset, match.index))));
        const link = element('a', match[1]);
        link.href = match[2].startsWith('https://') ? match[2] : '../' + match[2];
        link.target = '_blank'; link.rel = 'noopener'; node.append(link);
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
    page.title = (project.name || project.project_id) + (name === 'prd.md' ? ' · PRD' : ' · 项目方案');
    page.documentElement.lang = 'zh-CN';
    const style = element('style');
    style.textContent = document.querySelector('head style').textContent + '\n@page {size:A4;margin:18mm} body{background:white;color:#202d40} .document-body{max-width:none;margin:0} h2,h3,h4{break-after:avoid} p,li{orphans:3;widows:3}';
    page.head.append(style);
    page.body.append(markdownDocument(documentDrafts[name] ?? data.documents[name]));
    frame.contentWindow.addEventListener('afterprint', () => frame.remove(), {once: true});
    frame.contentWindow.focus(); frame.contentWindow.print();
  }
  function documents() {
    const name = selectedDocument;
    const items = [['proposal.md', '项目方案'], ['prd.md', 'PRD']];
    content.append(sectionTabs(items, name, '文档类型', key => { selectedDocument = key; documentChapter = 0; documentEntry = 0; documentEditing = false; documentMessage = ''; render(); }));
    const text = documentDrafts[name] ?? data.documents[name] ?? '';
    const chunks = text.split(/(?=^## )/m);
    let intro = chunks.shift() || '';
    let chapters = chunks.map((chunk, index) => ({key: String(index), title: chunk.split('\n')[0].replace(/^## /, ''), meta: '', text: chunk}));
    if (!chapters.length) { intro = ''; chapters = [{key: '0', title: '正文', meta: '', text}]; }
    documentChapter = Math.min(documentChapter, chapters.length - 1);
    const selectedIndex = documentChapter;
    const selected = chapters[selectedIndex];
    const detail = selectionLayout(chapters, String(selectedIndex), '文档章节', key => { documentChapter = Number(key); documentEntry = 0; documentEditing = false; });
    const card = panel(selected.title);
    const actions = element('div', null, 'document-actions');
    const edit = element('button', documentEditing ? '预览本节' : '编辑本节', 'button small');
    edit.type = 'button'; edit.disabled = documentSaving;
    edit.addEventListener('click', () => { documentEditing = !documentEditing; render(); });
    const print = element('button', '打印 / PDF', 'button small'); print.type = 'button';
    print.addEventListener('click', () => printDocument(name));
    const download = element('button', '下载正文', 'button small'); download.type = 'button';
    download.addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([documentDrafts[name] ?? data.documents[name]], {type: 'text/markdown;charset=utf-8'}));
      const link = element('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    actions.append(edit, print, download);
    const save = element('button', '保存新版本', 'button primary small'); save.type = 'button';
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
    card.append(actions);
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
  function prototype() {
    artifactPreviews('prototype/', '暂无原型');
  }
  function database() {
    if (data.artifacts.some(item => item.path.startsWith('data-model/') && item.path.endsWith('.html'))) {
      artifactPreviews('data-model/', '交互式 ERD 待生成');
      return;
    }
    const model = project.business_model;
    if (Array.isArray(model.entities) && model.entities.length) {
      for (const entity of model.entities) {
        const card = panel(entity.name || entity.entity_id || '业务实体');
        if (Array.isArray(entity.fields)) {
          card.append(dataTable(entity.fields.map(field => {
            const {name, field_id, ...definition} = field;
            return [name || field_id, definition];
          })));
        } else card.append(dataTable(Object.entries(entity)));
        content.append(card);
      }
      if (Array.isArray(model.relations) && model.relations.length) {
        const relations = panel('实体关系');
        relations.append(dataTable(model.relations.map((relation, index) => [relation.name || '关系 ' + (index + 1), relation])));
        content.append(relations);
      }
    } else content.append(empty('业务数据模型待整理'));
    artifactPreviews('data-model/', '交互式 ERD 待生成');
  }
  function api() {
    const apis = (project.apis || []).filter(matches);
    if (!apis.length) { content.append(empty('暂无接口设计')); return; }
    for (const item of apis) {
      const card = panel(item.name || item.api_id);
      fields(card, [['接口', display(item.method) + ' ' + display(item.path)], ['关联需求', item.requirement_ids], ['请求', item.request], ['响应', item.response], ['异常', item.errors], ['确认状态', item.review_status]]);
      requirements.filter(req => (item.requirement_ids || []).includes(req.requirement_id)).forEach(req => card.append(requirementLink(req)));
      content.append(card);
    }
  }
  function reviewForm(host = content, phase = 'definition') {
    const section = panel('记录评审意见');
    if (!serverState) {
      section.append(element('p', '本地运行器提供版本绑定的评审保存和导出。', 'inline-note'));
      host.append(section);
      return;
    }
    const form = element('form', null, 'intake-form');
    const stage = element('select'); stage.id = 'review-stage';
    for (const [value, title] of [['definition', '需求定义'], ['release', '客户发布']]) { const option = element('option', title); option.value = value; stage.append(option); }
    stage.value = phase;
    const target = element('select'); target.id = 'review-target';
    let targets;
    function fillTargets() {
      targets = new Set(stage.value === 'release' ? data.artifacts.filter(item => item.path.startsWith('prototype/') && item.path.endsWith('.html')).map(item => item.path) : [...requirements.map(item => item.requirement_id), ...data.review.questions.map(item => item.target)]);
      target.replaceChildren();
      targets.forEach(value => { const req = requirements.find(item => item.requirement_id === value); const option = element('option', req ? req.title : value); option.value = value; target.append(option); });
      if (reviewTarget && targets.has(reviewTarget)) target.value = reviewTarget;
    }
    fillTargets(); stage.addEventListener('change', () => { fillTargets(); save.disabled = !targets.size; });
    const outcome = element('select'); outcome.id = 'review-outcome';
    for (const [value, label] of [['needs_changes', '需要修改'], ['confirmed', '确认此项'], ['parked', '暂缓']]) { const option = element('option', label); option.value = value; outcome.append(option); }
    const reviewer = element('input'); reviewer.id = 'review-author'; reviewer.maxLength = 200;
    const comment = element('textarea'); comment.id = 'review-comment'; comment.rows = 3; comment.maxLength = 10000;
    for (const [input, title] of [...(phase === 'release' ? [[target, '评审对象']] : []), [outcome, '结论'], [reviewer, '记录人（选填）'], [comment, '意见']]) { const label = element('label', title); label.htmlFor = input.id; form.append(label, input); }
    const save = element('button', '保存意见', 'button primary'); save.type = 'submit'; save.disabled = !targets.size;
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
    const refresh = element('button', '刷新记录', 'button');
    refresh.type = 'button';
    refresh.addEventListener('click', async () => {
      try { await refreshLocal(); render(); } catch (error) { message.textContent = error.message; }
    });
    section.append(refresh);
    const records = serverState.review.decisions;
    if (records.length) {
      const exportButton = element('button', '导出评审记录', 'button');
      exportButton.type = 'button';
      exportButton.addEventListener('click', () => downloadJson({project_id: project.project_id, artifact_version: project.artifact_version, ...serverState.review, review_stage: stage.value, decisions: serverState.review.decisions.filter(item => (item.review_stage || 'definition') === stage.value)}, 'review-notes.json'));
      section.append(exportButton);
    }
    if (phase === 'release') { host.append(section); return; }
    const apply = element('form', null, 'intake-form');
    const label = element('label', '评审后的目标版本'); label.htmlFor = 'review-version';
    const version = element('input'); version.id = 'review-version'; version.value = nextVersion(); version.required = true;
    const submit = element('button', '应用意见与修订', 'button primary'); submit.type = 'submit'; submit.disabled = workflowBusy || (!records.some(item => (item.review_stage || 'definition') === 'definition') && !pendingChanges.length);
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
      const submit = element('button', '生成客户交付包', 'button primary'); submit.type = 'submit'; submit.disabled = workflowBusy;
      form.append(submit);
      form.addEventListener('submit', event => {
        event.preventDefault(); const selected = choices.filter(([, checkbox]) => checkbox.checked).map(([path]) => path); const revision = serverState.review.revision;
        workflowAction(() => localRequest('/api/release', {method: 'POST', body: JSON.stringify({files: selected, revision})}));
      });
      card.append(form, element('p', '先在客户发布阶段复核选定原型。交付包可用于静态部署，部署结果另行记录。', 'inline-note'));
    } else card.append(element('p', '当前版本尚无可交付原型'));
    if (workflowMessage) card.append(element('p', workflowMessage, 'inline-note'));
    for (const release of serverState.releases || []) {
      const row = element('section', null, 'inbox-row'); row.append(element('h3', release.artifact_version + ' · 客户交付包'));
      const preview = element('a', '预览客户包', 'button'); preview.href = '/customer/' + release.release_id + '/index.html'; preview.target = '_blank'; preview.rel = 'noopener';
      const download = element('a', '下载 ZIP', 'button'); download.href = '/api/releases/' + release.release_id + '/package'; download.download = project.project_id + '-' + release.artifact_version + '.zip';
      row.append(preview, download); card.append(row);
    }
    content.append(card);
  }
  function review() {
    content.append(sectionTabs([['questions', '待确认'], ['records', '已记录'], ['changes', '版本变更'], ['delivery', '交付']], reviewTab, '评审内容', key => { reviewTab = key; render(); }));
    if (reviewTab === 'delivery') { releasePanel(); reviewForm(content, 'release'); return; }
    if (reviewTab === 'records') {
      const records = [...(data.review.decisions || []), ...(serverState?.review.decisions || [])];
      const seen = new Set();
      const labels = {confirmed: '已确认', needs_changes: '需要修改', parked: '暂缓'};
      records.forEach(record => {
        const identity = JSON.stringify(record); if (seen.has(identity) || !matches(record)) return; seen.add(identity);
        const req = requirements.find(item => item.requirement_id === record.target);
        const card = panel(req?.title || record.target || '评审意见');
        fields(card, [['结论', labels[record.outcome] || record.outcome], ['意见', record.comment], ['记录人', record.reviewer], ['时间', record.decided_at || record.created_at || record.created]] .filter(([, value]) => value));
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
      return {key: target, title: req?.title || ({business_model: '业务模型', pages: '页面定义', requirements: '功能需求'}[target] || (target.startsWith('requirement_profile.') ? '项目背景与范围' : target)), meta: req ? ({draft: '待核对', confirmed: '已确认', disputed: '需讨论', parked: '暂缓'}[req.review_status] || '') : '', req, issues};
    }).filter(group => matches([group.title, group.key, group.issues]));
    const current = groups.find(group => group.key === reviewTarget) || groups[0];
    if (!current) { content.append(empty('没有匹配的评审事项')); return; }
    reviewTarget = current.key;
    const detail = selectionLayout(groups, current.key, '评审事项', key => { reviewTarget = key; reviewMessage = ''; });
    const card = panel(current.title);
    const reasons = [...new Set(current.issues.map(issue => issue.reason))];
    const specific = reasons.filter(reason => reason !== '核对依据、范围与确认状态');
    const shown = specific.length ? specific : reasons;
    if (shown.length) { const list = element('ul', null, 'review-issues'); shown.forEach(reason => list.append(element('li', reason))); card.append(list); }
    else card.append(element('p', '核对功能、范围与验收标准', 'inline-note'));
    if (current.req) {
      const button = element('button', '查看需求和原话 →', 'source-link'); button.type = 'button';
      button.addEventListener('click', () => { selectedRequirement = current.key; queryInput.value = current.key; statusInput.value = ''; evidenceInput.value = ''; navigate('modules'); }); card.append(button);
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
      const button = element('button', label, 'button ghost small');
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
    document.getElementById('page-title').textContent = views[active];
    document.getElementById('view-label').textContent = views[active];
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
      const filters = element('button', (showFilters ? '收起筛选' : '筛选') + ((statusInput.value || evidenceInput.value) ? ' · 已启用' : ''), 'button small');
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
  document.getElementById('project-brand').textContent = project.name || project.project_id;
  document.getElementById('project-label').textContent = project.name || project.project_id;
  for (const [view, title] of Object.entries(views)) {
    const button = element('button', title, 'nav-button');
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
  document.getElementById('export-project').addEventListener('click', () => downloadJson(project, 'project.json'));
  [queryInput, statusInput, evidenceInput].forEach(input => input.addEventListener('input', () => { selectedSource = null; render(); }));
  window.addEventListener('message', event => {
    if (active !== 'modules' || !moduleFrame || event.source !== moduleFrame.contentWindow || event.data?.type !== 'product-requirements:module-select') return;
    const match = /^module_(\d+)$/.exec(event.data.id || '');
    if (match && Number(match[1]) < (project.modules || []).length) selectDiagramModule?.(Number(match[1]));
  });
  window.addEventListener('hashchange', () => navigate(location.hash.slice(1)));
  navigate(location.hash.slice(1));
  if (location.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(location.hostname)) {
    refreshLocal().then(render).catch(error => { intakeMessage = error.message; });
  }
})();
