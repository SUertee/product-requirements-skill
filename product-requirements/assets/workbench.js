(() => {
  'use strict';
  const data = JSON.parse(document.getElementById('workbench-data').textContent);
  const project = data.project;
  const requirements = project.requirements;
  const sourceMap = new Map(data.sources.map(source => [source.source_id, source]));
  const states = {draft: '草稿', confirmed: '已确认', disputed: '冲突', parked: '暂缓'};
  const evidenceNames = {explicit: '明确表达', inferred: '模型推断', suggested: '产品建议', unknown: '待确认'};
  const views = {overview: '项目总览', materials: '会议与素材', modules: '功能模块与需求', documents: '方案与 PRD', database: '数据库设计', api: 'API 设计', prototype: '原型预览', diagrams: '流程与架构', review: '版本与评审'};
  const content = document.getElementById('page-content');
  const queryInput = document.getElementById('search');
  const statusInput = document.getElementById('status');
  const evidenceInput = document.getElementById('evidence');
  let active = 'overview';
  let selectedSource = null;

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
  function fields(parent, pairs) {
    const list = element('dl', null, 'workbench-values');
    for (const [label, value] of pairs) {
      list.append(element('dt', label), element('dd', display(value)));
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
    detail.append(element('summary', '规则、异常与依据'));
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
    const profile = panel('需求画像');
    const profileLabels = {customer_and_roles: '客户与角色', business_scenario: '业务场景', pain_points: '核心痛点', desired_outcomes: '目标结果', scope: '需求范围', constraints: '约束条件', integrations: '集成与依赖', evidence_and_questions: '证据与待确认'};
    fields(profile, Object.entries(profileLabels).map(([key, label]) => [label, project.requirement_profile[key]]));
    content.append(profile);
    const grid = element('div', null, 'workbench-grid');
    for (const [key, name] of Object.entries(states)) {
      const state = panel(name);
      state.append(element('strong', requirements.filter(req => req.review_status === key).length));
      grid.append(state);
    }
    content.append(grid);
    const questions = panel('待确认问题');
    data.review.questions.slice(0, 5).forEach(question => questions.append(element('p', question.target + ' · ' + question.reason)));
    if (!data.review.questions.length) questions.append(element('p', '整体成果等待人工评审'));
    content.append(questions);
  }
  function materials() {
    if (project.meetings && project.meetings.length) {
      const section = panel('会议记录');
      for (const meeting of project.meetings.filter(matches)) {
        fields(section, [['会议', meeting.title || meeting.meeting_id], ['日期', meeting.date], ['关联素材', meeting.material_ids]]);
      }
      content.append(section);
    }
    const groups = new Map();
    for (const source of data.sources) {
      const key = source.material_id || source.source_name || '会议材料';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(source);
    }
    let shown = 0;
    for (const sources of groups.values()) {
      const visible = sources.filter(source => (!selectedSource || source.source_id === selectedSource) && matches(source));
      if (!visible.length) continue;
      const card = panel(sources[0].source_name || '会议原话');
      for (const source of visible) {
        const detail = element('details');
        detail.open = Boolean(selectedSource);
        detail.append(element('summary', source.source_id + ' · ' + display(source.locator)));
        detail.append(element('blockquote', source.text, 'source-quote'));
        const linked = requirements.filter(req => req.source_refs.includes(source.source_id));
        linked.forEach(req => {
          const button = element('button', req.requirement_id + ' · ' + req.title, 'source-link');
          button.type = 'button';
          button.addEventListener('click', () => {
            queryInput.value = req.requirement_id;
            statusInput.value = '';
            evidenceInput.value = '';
            navigate('modules');
          });
          detail.append(button);
        });
        card.append(detail);
        shown++;
      }
      content.append(card);
    }
    for (const material of (project.materials || []).filter(matches)) {
      const card = panel(material.name || material.material_id);
      fields(card, [['类型', material.kind], ['关联来源', material.source_ids]]);
      const attached = data.attachments.find(item => item.material_id === material.material_id);
      if (attached) {
        card.append(fileLink(attached.path, '打开素材'));
        if (/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(attached.path)) {
          const audio = element('audio');
          audio.controls = true;
          audio.preload = 'none';
          audio.src = '../' + attached.path.split('/').map(encodeURIComponent).join('/');
          card.append(audio);
        }
      }
      content.append(card);
      shown++;
    }
    if (selectedSource) {
      const reset = element('button', '查看全部素材', 'button ghost small');
      reset.addEventListener('click', () => { selectedSource = null; render(); });
      content.prepend(reset);
    }
    if (project.context_sources.length) {
      const context = panel('前情资料');
      context.append(element('pre', display(project.context_sources), 'workbench-document'));
      content.append(context);
      shown++;
    }
    if (!shown) content.append(empty('暂无匹配的会议原话或素材'));
  }
  function modules() {
    const visible = filteredRequirements();
    const assigned = new Set();
    for (const module of project.modules || []) {
      const items = visible.filter(req => module.requirement_ids.includes(req.requirement_id));
      if (!items.length && !matches(module)) continue;
      const card = panel(module.name || module.module_id);
      badges(card, [module.module_id, items.length + ' 条匹配需求']);
      items.forEach(req => { card.append(requirementCard(req)); assigned.add(req.requirement_id); });
      content.append(card);
    }
    const remaining = visible.filter(req => !assigned.has(req.requirement_id));
    remaining.forEach(req => content.append(requirementCard(req)));
    if (!content.children.length) content.append(empty('暂无匹配需求'));
  }
  function documents() {
    for (const [path, title] of [['proposal.md', '项目方案'], ['prd.md', '产品需求文档']]) {
      const card = panel(title);
      card.append(fileLink(path, '打开文件'));
      const detail = element('details');
      detail.open = true;
      detail.append(element('summary', '阅读正文'), element('pre', data.documents[path], 'workbench-document'));
      card.append(detail);
      content.append(card);
    }
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
    const card = panel('业务数据模型');
    card.append(element('pre', display(project.business_model), 'workbench-document'));
    content.append(card);
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
    const card = panel('版本与评审');
    fields(card, [['当前版本', project.artifact_version], ['基线', project.baseline_version], ['文档评审', data.review.review_status]]);
    content.append(card);
    for (const question of data.review.questions.filter(matches)) {
      const issue = panel(question.target);
      issue.append(element('p', question.reason));
      if (question.field) fields(issue, [['待补字段', question.field]]);
      content.append(issue);
    }
    const decisions = panel('评审决定');
    decisions.append(element('pre', data.review.decisions.length ? display(data.review.decisions) : '等待人工核对与记录决定', 'workbench-document'));
    content.append(decisions);
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
    const renderers = {overview, materials, modules, documents, database, api, review,
      prototype: () => artifactPreviews('prototype/', '原型等待需求确认与实际生成'),
      diagrams: () => artifactPreviews('diagrams/', '流程与架构图待生成')};
    renderers[active]();
  }
  function navigate(view) {
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
    button.addEventListener('click', () => { selectedSource = null; navigate(view); });
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
  [queryInput, statusInput, evidenceInput].forEach(input => input.addEventListener('input', render));
  window.addEventListener('hashchange', () => navigate(location.hash.slice(1)));
  navigate(location.hash.slice(1));
})();
