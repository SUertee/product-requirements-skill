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
    card.append(detail);
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
  function materials() {
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
    for (const line of text.split('\n')) {
      const heading = /^(#{1,4}) (.*)$/.exec(line);
      const bullet = /^- (.*)$/.exec(line);
      if (heading) {
        list = null;
        body.append(element('h' + Math.min(4, heading[1].length + 1), heading[2].replace(/\\([\\`*_{}\[\]<>()#!|>~])/g, '$1')));
      } else if (bullet) {
        if (!list) { list = element('ul'); body.append(list); }
        list.append(element('li', bullet[1].replace(/\\([\\`*_{}\[\]<>()#!|>~])/g, '$1')));
      } else {
        list = null;
        if (line.trim()) body.append(element('p', line.replace(/\\([\\`*_{}\[\]<>()#!|>~])/g, '$1')));
      }
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
  function database() {
    const model = project.business_model;
    if (Array.isArray(model.entities) && model.entities.length) {
      for (const entity of model.entities) {
        const card = panel(entity.name || entity.entity_id || '业务实体');
        if (Array.isArray(entity.fields)) {
          card.append(dataTable(entity.fields.map(field => [field.name || field.field_id, field.type || field.description || '待确认'])));
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
      content.append(card);
    }
  }
  function review() {
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
    const renderers = {overview, materials, modules, documents, technical, review,
      prototype: () => artifactPreviews('prototype/', '原型等待需求确认与实际生成')};
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
  document.getElementById('export-project').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(project, null, 2)], {type: 'application/json'}));
    const link = element('a');
    link.href = url;
    link.download = 'project.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  [queryInput, statusInput, evidenceInput].forEach(input => input.addEventListener('input', () => { selectedSource = null; render(); }));
  window.addEventListener('hashchange', () => navigate(location.hash.slice(1)));
  navigate(location.hash.slice(1));
})();
