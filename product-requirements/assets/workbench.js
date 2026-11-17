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
  let selectedMaterial = null;
  let selectedModule = null;
  let selectedDocument = 'proposal.md';
  let serverState = null;
  let intakeBusy = false;
  let intakeMessage = '';
  let reviewMessage = '';
  let reviewTarget = null;

  function element(tag, text, className) {
    const result = document.createElement(tag);
    if (text !== undefined && text !== null) result.textContent = String(text);
    if (className) result.className = className;
    return result;
  }
  function display(value) {
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length) || (typeof value === 'object' && !Object.keys(value).length)) return '待确认';
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  }
  function empty(text) { return element('div', text, 'workbench-empty'); }
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
    return requirements.filter(req => matches(req) && (!statusInput.value || req.review_status === statusInput.value) && (!evidenceInput.value || req.evidence_type === evidenceInput.value));
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
    const button = element('button', req.requirement_id + ' · ' + req.title, 'source-link');
    button.type = 'button';
    button.addEventListener('click', () => {
      queryInput.value = req.requirement_id;
      statusInput.value = '';
      evidenceInput.value = '';
      selectedModule = null;
      navigate('modules');
    });
    return button;
  }
  function sourceLink(sourceId) {
    const button = element('button', sourceId, 'source-link');
    button.type = 'button';
    button.addEventListener('click', () => {
      selectedSource = sourceId;
      queryInput.value = '';
      navigate('materials');
    });
    return button;
  }
  function requirementCard(req) {
    const card = panel(req.requirement_id + ' · ' + req.title);
    badges(card, [states[req.review_status], evidenceNames[req.evidence_type]]);
    fields(card, [['角色', req.role], ['行为', req.behavior], ['验收', req.acceptance_criteria]]);
    const detail = element('details');
    detail.append(element('summary', '查看规则和依据'));
    fields(detail, [['触发', req.trigger], ['输入', req.inputs], ['输出', req.outputs], ['规则', req.rules], ['异常', req.exceptions]]);
    for (const sourceId of req.source_refs) {
      const source = sourceMap.get(sourceId);
      detail.append(sourceLink(sourceId), element('blockquote', source.text, 'source-quote'));
    }
    const reviewButton = element('button', '记录评审意见', 'button ghost small');
    reviewButton.type = 'button';
    reviewButton.addEventListener('click', () => { reviewTarget = req.requirement_id; navigate('review'); });
    card.append(detail, reviewButton);
    return card;
  }
  function overview() {
    const card = panel(project.name || project.project_id);
    fields(card, [['目标', project.requirement_profile.desired_outcomes], ['范围', project.requirement_profile.scope], ['版本', project.artifact_version], ['基线', project.baseline_version]]);
    content.append(card);
    const summary = element('div', null, 'workbench-summary');
    for (const [label, count] of [['需求', requirements.length], ['已确认', requirements.filter(req => req.review_status === 'confirmed').length], ['待确认', data.review.questions.length]]) {
      const item = element('span', label);
      item.append(element('strong', count));
      summary.append(item);
    }
    content.append(summary);
    const outputs = panel('项目成果');
    for (const [view, label, prefix] of [['documents', '方案文档', null], ['prototype', '原型预览', 'prototype/'], ['technical', '技术设计', 'diagrams/']]) {
      const row = element('button', null, 'output-row');
      row.type = 'button';
      const available = prefix ? data.artifacts.some(item => item.path.startsWith(prefix) && item.path.endsWith('.html')) : true;
      const actionLabel = view === 'technical' ? '查看模型与图示 →' : available ? '查看当前版本 →' : '查看待生成内容 →';
      row.append(element('strong', label), element('span', actionLabel));
      row.addEventListener('click', () => navigate(view));
      outputs.append(row);
    }
    content.append(outputs);
    if (serverState && serverState.jobs.length) {
      const intake = panel('素材处理');
      badges(intake, [serverState.jobs.filter(job => job.status === 'ready_for_analysis').length + ' 份待分析', serverState.jobs.filter(job => job.status === 'awaiting_transcript').length + ' 份待转写', serverState.jobs.filter(job => job.status === 'failed').length + ' 份处理失败']);
      const open = element('button', '查看接收箱', 'button');
      open.type = 'button'; open.addEventListener('click', () => navigate('materials')); intake.append(open);
      content.append(intake);
    }
    const profile = element('details', null, 'panel requirement-card');
    profile.append(element('summary', '需求画像'));
    const profileLabels = {customer_and_roles: '客户与角色', business_scenario: '业务场景', pain_points: '核心痛点', desired_outcomes: '目标结果', scope: '需求范围', constraints: '约束条件', integrations: '集成与依赖', evidence_and_questions: '证据与待确认'};
    fields(profile, Object.entries(profileLabels).map(([key, label]) => [label, project.requirement_profile[key]]));
    content.append(profile);
    const questions = panel('待确认问题');
    data.review.questions.slice(0, 5).forEach(question => questions.append(element('p', question.target + ' · ' + question.reason)));
    if (!data.review.questions.length) questions.append(element('p', '整体成果等待人工评审'));
    content.append(questions);
  }
  async function localRequest(path, options = {}) {
    const response = await fetch(path, {...options, headers: {'X-Workbench-Request': '1', ...options.headers}});
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
    const connector = element('details');
    connector.append(element('summary', '从飞书妙记获取'));
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
      badges(row, [labels[job.status] || job.status, job.kind === 'recording' ? '音视频' : '逐字稿', job.source_count ? job.source_count + ' 段原话' : job.stage]);
      if (job.provenance.related_job_id) row.append(element('p', '关联录音 · ' + (serverState.jobs.find(item => item.job_id === job.provenance.related_job_id)?.name || job.provenance.related_job_id), 'inline-note'));
      if (job.error) row.append(element('p', job.error, 'inline-note'));
      const actions = element('div', null, 'document-actions');
      for (const [key, label] of [['original', '原始素材'], ['sources', '来源片段'], ['analysis_request', '分析请求']]) if (job.files[key]) actions.append(jobLink(job, key, label));
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
    jobs.append(element('p', '接收箱保留新材料。Skill 完成分析并生成下一版本后，需求和文档进入对应页面。', 'inline-note'));
    const refresh = element('button', '刷新接收箱', 'button');
    refresh.type = 'button';
    refresh.disabled = intakeBusy;
    refresh.addEventListener('click', async () => {
      try { await refreshLocal(); render(); } catch (error) { intakeMessage = error.message; render(); }
    });
    jobs.append(refresh);
    content.append(jobs);
  }
  function materials() {
    intakePanel();
    const entries = [];
    const assigned = new Set();
    for (const material of project.materials || []) {
      const sources = data.sources.filter(source => (material.source_ids || []).includes(source.source_id) || source.material_id === material.material_id);
      sources.forEach(source => assigned.add(source.source_id));
      const meetings = (project.meetings || []).filter(meeting => (meeting.material_ids || []).includes(material.material_id));
      entries.push({key: 'material:' + material.material_id, title: material.name || material.material_id, meta: (material.kind || '素材') + ' · ' + sources.length + ' 段原话', material, sources, meetings});
    }
    const groups = new Map();
    data.sources.filter(source => !assigned.has(source.source_id)).forEach(source => {
      const key = source.material_id || source.source_name || 'transcript';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(source);
    });
    groups.forEach((sources, key) => entries.push({key: 'source:' + key, title: sources[0].source_name || '会议原话', meta: sources.length + ' 段原话', sources, meetings: (project.meetings || []).filter(meeting => (meeting.material_ids || []).includes(key))}));
    if (project.context_sources.length) entries.push({key: 'context', title: '前情资料', meta: project.context_sources.length + ' 项背景资料', sources: [], meetings: [], context: project.context_sources});
    const visible = entries.filter(item => matches(item));
    const selected = visible.find(item => selectedSource && item.sources.some(source => source.source_id === selectedSource)) || visible.find(item => item.key === selectedMaterial) || visible[0];
    if (!selected) { content.append(empty('暂无匹配素材，可调整搜索词后查看')); return; }
    selectedMaterial = selected.key;
    const detail = selectionLayout(visible, selected.key, '会议素材列表', key => { selectedMaterial = key; selectedSource = null; });
    const card = panel(selected.title);
    if (selected.context) {
      card.append(valueNode(selected.context));
      detail.append(card);
      return;
    }
    selected.meetings.forEach(meeting => fields(card, [['会议', meeting.title || meeting.meeting_id], ['日期', meeting.date]]));
    const attached = data.attachments.find(item => item.material_id === selected.material?.material_id);
    if (attached) {
      card.append(fileLink(attached.path, '打开素材'));
      if (/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(attached.path)) {
        const audio = element('audio');
        audio.controls = true;
        audio.preload = 'none';
        audio.src = '../' + attached.path.split('/').map(encodeURIComponent).join('/');
        card.append(audio);
      }
    } else if (selected.material) card.append(element('p', '原始文件尚未随当前版本附带', 'inline-note'));
    selected.sources.forEach(source => {
      const excerpt = element('section', null, 'source-excerpt');
      if (source.source_id === selectedSource) excerpt.classList.add('source-selected');
      badges(excerpt, [locatorLabel(source.locator), source.speaker || '说话人待确认', source.source_id]);
      excerpt.append(element('blockquote', source.text, 'source-quote'));
      const linked = requirements.filter(req => req.source_refs.includes(source.source_id));
      linked.forEach(req => excerpt.append(requirementLink(req)));
      card.append(excerpt);
    });
    if (!selected.sources.length) card.append(element('p', '当前素材尚无可定位的原话片段', 'inline-note'));
    detail.append(card);
    if (selectedSource) detail.querySelector('.source-selected')?.scrollIntoView?.({block: 'nearest'});
  }
  function modules() {
    const visible = filteredRequirements();
    const groups = (project.modules || []).map(module => ({
      key: 'module:' + module.module_id, title: module.name || module.module_id,
      items: visible.filter(req => (module.requirement_ids || []).includes(req.requirement_id))
    }));
    const assigned = new Set((project.modules || []).flatMap(module => module.requirement_ids || []));
    const remaining = visible.filter(req => !assigned.has(req.requirement_id));
    if (remaining.length) groups.push({key: 'unassigned', title: '待归类', items: remaining});
    const choices = groups.filter(group => group.items.length).map(group => ({...group, meta: group.items.length + ' 条需求 · ' + group.items.filter(req => req.review_status === 'confirmed').length + ' 条已确认'}));
    const selected = choices.find(group => group.key === selectedModule) || choices[0];
    if (!selected) { content.append(empty('暂无匹配需求，可调整搜索词或筛选条件')); return; }
    selectedModule = selected.key;
    const detail = selectionLayout(choices, selected.key, '业务模块列表', key => { selectedModule = key; });
    const card = panel(selected.title);
    selected.items.forEach(req => card.append(requirementCard(req)));
    detail.append(card);
  }
  function markdownDocument(text) {
    const body = element('div', null, 'document-body');
    let list = null;
    const unescape = value => value.replace(/\\([\\`*_{}\[\]<>()#!|>~])/g, '$1');
    for (const block of text.split(/\n\s*\n/)) {
      const decoded = unescape(block.trim());
      if (decoded.startsWith('[') || decoded.startsWith('{')) {
        try { body.append(valueNode(JSON.parse(decoded))); continue; } catch { /* Render ordinary text literally. */ }
      }
      for (const line of block.split('\n')) {
        const heading = /^(#{1,4}) (.*)$/.exec(line);
        const bullet = /^- (.*)$/.exec(line);
        if (heading) {
          list = null;
          body.append(element('h' + Math.min(4, heading[1].length + 1), unescape(heading[2])));
        } else if (bullet) {
          if (!list) { list = element('ul'); body.append(list); }
          list.append(element('li', unescape(bullet[1])));
        } else {
          list = null;
          if (line.trim()) body.append(element('p', unescape(line)));
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
  function documents() {
    const items = [{key: 'proposal.md', title: '项目方案', meta: '目标、范围、实现思路'}, {key: 'prd.md', title: 'PRD', meta: '功能、规则、异常、验收'}];
    const selected = items.find(item => item.key === selectedDocument) || items[0];
    const detail = selectionLayout(items, selected.key, '方案文档列表', key => { selectedDocument = key; });
    const card = panel(selected.title);
    card.append(fileLink(selected.key, '打开文件'));
    card.append(markdownDocument(data.documents[selected.key]));
    detail.append(card);
  }
  function artifactPreviews(prefix, emptyMessage) {
    const files = data.artifacts.filter(item => item.path.startsWith(prefix) && item.path.endsWith('.html'));
    if (!files.length) { content.append(empty(emptyMessage)); return; }
    for (const artifact of files) {
      const card = panel(artifact.path);
      card.append(fileLink(artifact.path, '打开完整页面'));
      const frame = element('iframe', null, 'workbench-preview');
      frame.title = artifact.path;
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.src = '../' + artifact.path.split('/').map(encodeURIComponent).join('/');
      card.append(frame);
      content.append(card);
    }
  }
  function prototype() {
    artifactPreviews('prototype/', '原型等待定义确认与实际生成');
    const pages = panel('页面定义');
    for (const page of project.pages) {
      const section = element('section', null, 'inbox-row');
      section.append(element('h3', page.name || page.page_id));
      badges(section, [page.page_id]);
      if (page.task || page.goal) fields(section, [['任务', page.task || page.goal]]);
      requirements.filter(req => page.requirement_ids.includes(req.requirement_id)).forEach(req => section.append(requirementLink(req)));
      pages.append(section);
    }
    if (!project.pages.length) pages.append(element('p', '核心页面与对应需求待整理'));
    content.append(pages);
  }
  function database() {
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
    if (!apis.length) { content.append(empty('暂无已整理的 API 草案')); return; }
    for (const item of apis) {
      const card = panel(item.name || item.api_id);
      fields(card, [['接口', display(item.method) + ' ' + display(item.path)], ['关联需求', item.requirement_ids], ['请求', item.request], ['响应', item.response], ['异常', item.errors], ['确认状态', item.review_status]]);
      requirements.filter(req => (item.requirement_ids || []).includes(req.requirement_id)).forEach(req => card.append(requirementLink(req)));
      content.append(card);
    }
  }
  function reviewForm() {
    const section = panel('记录评审意见');
    if (!serverState) {
      section.append(element('p', '本地运行器提供版本绑定的评审保存和导出。', 'inline-note'));
      content.append(section);
      return;
    }
    const form = element('form', null, 'intake-form');
    const target = element('select'); target.id = 'review-target';
    const targets = new Set([...requirements.map(item => item.requirement_id), ...data.review.questions.map(item => item.target)]);
    targets.forEach(value => { const option = element('option', value); option.value = value; target.append(option); });
    if (reviewTarget && targets.has(reviewTarget)) target.value = reviewTarget;
    const outcome = element('select'); outcome.id = 'review-outcome';
    for (const [value, label] of [['needs_changes', '需要修改'], ['confirmed', '确认此项'], ['parked', '暂缓']]) { const option = element('option', label); option.value = value; outcome.append(option); }
    const reviewer = element('input'); reviewer.id = 'review-author'; reviewer.maxLength = 200;
    const comment = element('textarea'); comment.id = 'review-comment'; comment.rows = 3; comment.maxLength = 10000;
    for (const [input, title] of [[target, '评审对象'], [outcome, '结论'], [reviewer, '记录人（选填）'], [comment, '意见']]) { const label = element('label', title); label.htmlFor = input.id; form.append(label, input); }
    const save = element('button', '保存意见', 'button primary'); save.type = 'submit'; save.disabled = !targets.size;
    const revision = serverState.review.revision;
    form.addEventListener('submit', async event => {
      event.preventDefault(); save.disabled = true;
      try {
        const result = await localRequest('/api/review', {method: 'POST', body: JSON.stringify({revision, target: target.value, outcome: outcome.value, comment: comment.value, reviewer: reviewer.value})});
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
      exportButton.addEventListener('click', () => downloadJson({project_id: project.project_id, artifact_version: project.artifact_version, review_stage: 'definition', ...serverState.review}, 'review-notes.json'));
      section.append(exportButton, valueNode(records));
    }
    content.append(section);
  }
  function review() {
    reviewForm();
    const card = panel('评审记录');
    fields(card, [['当前版本', project.artifact_version], ['基线', project.baseline_version], ['文档评审', data.review.review_status]]);
    content.append(card);
    for (const question of data.review.questions.filter(matches)) {
      const issue = panel(question.target);
      issue.append(element('p', question.reason));
      if (question.field) fields(issue, [['待补字段', question.field]]);
      content.append(issue);
    }
    const decisions = panel('评审决定');
    if (data.review.decisions.length) decisions.append(valueNode(data.review.decisions));
    else decisions.append(element('p', '等待人工核对与记录决定'));
    content.append(decisions);
  }
  function technical() {
    const tabs = {diagrams: '流程架构', database: '数据库', api: 'API'};
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
    else artifactPreviews('diagrams/', '流程架构图待生成');
    Array.from(content.children).filter(child => !before.has(child)).forEach(child => panelNode.append(child));
  }

  function render() {
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
    statusInput.hidden = active !== 'modules';
    evidenceInput.hidden = active !== 'modules';
    document.querySelector('.workbench-toolbar').hidden = !['materials', 'modules', 'review'].includes(active) && !(active === 'technical' && technicalTab === 'api');
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
  document.getElementById('project-label').textContent = project.project_id;
  document.getElementById('project-status').textContent = '内部评审草稿 · ' + project.artifact_version + ' · ' + data.review.questions.length + ' 个待确认项';
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
  window.addEventListener('hashchange', () => navigate(location.hash.slice(1)));
  navigate(location.hash.slice(1));
  if (location.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(location.hostname)) {
    refreshLocal().then(render).catch(error => { intakeMessage = error.message; });
  }
})();
