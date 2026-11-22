(() => {
  'use strict';
  const data = JSON.parse(document.getElementById('workbench-data').textContent);
  const project = data.project || {};
  const requirements = data.requirements || [];
  const evidence = data.evidence || [];
  const sources = data.sources || [];
  const segments = data.transcript_segments || [];
  const model = data.business_model || {};
  const reviews = data.reviews || {records: []};
  const technical = data.technical_design;
  const plan = data.delivery_plan;
  const brief = data.deck_brief;
  const artifacts = data.artifacts || [];
  const changesets = data.changesets || [];
  const content = document.getElementById('page-content');
  const search = document.getElementById('search');
  const statusInput = document.getElementById('status');
  const evidenceInput = document.getElementById('evidence');
  const segmentMap = new Map(segments.map(item => [item.segment_id, item]));
  const evidenceMap = new Map(evidence.map(item => [item.evidence_id, item]));
  const reviewSelections = new Map();
  const states = {draft: '草稿', confirmed: '已确认', disputed: '冲突', parked: '暂缓', cancelled: '已取消'};
  const evidenceNames = {E0: 'E0 · 缺失/冲突', E1: 'E1 · 明确表达', E2: 'E2 · 推断', E3: 'E3 · 建议'};
  const views = [
    ['overview', '项目总览'], ['materials', '会议素材'], ['modules', '功能模块'],
    ['documents', '方案文档'], ['prototype', '原型'], ['technical', '技术设计'], ['review', '评审记录'],
  ];
  const validViews = new Set(views.map(([key]) => key));
  let active = validViews.has(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
  let selectedSource = sources[0]?.source_id || null;
  let toastTimer;

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined && text !== null) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  }
  function display(value) {
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return '待确认';
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  }
  function valueNode(value, depth = 0) {
    if (value === null || value === undefined || typeof value !== 'object' || depth > 3) return node('span', display(value));
    if (Array.isArray(value)) {
      if (!value.length) return node('span', '待确认');
      const list = node('ul', null, 'value-list');
      value.forEach(item => {const row = node('li'); row.append(valueNode(item, depth + 1)); list.append(row);});
      return list;
    }
    const entries = Object.entries(value);
    if (!entries.length) return node('span', '待确认');
    const list = node('dl', null, 'value-object');
    entries.forEach(([key, item]) => {const dd = node('dd'); dd.append(valueNode(item, depth + 1)); list.append(node('dt', key), dd);});
    return list;
  }
  function panel(title, className = 'panel') {const section = node('section', null, className); if (title) section.append(node('h2', title)); return section;}
  function badges(parent, values) {const row = node('div', null, 'workbench-meta'); values.filter(value => value !== undefined && value !== null && value !== '').forEach(value => row.append(node('span', value))); parent.append(row); return row;}
  function fields(parent, pairs) {const list = node('dl', null, 'workbench-values'); pairs.forEach(([label, value]) => {const dd = node('dd'); dd.append(valueNode(value)); list.append(node('dt', label), dd);}); parent.append(list); return list;}
  function empty(text) {return node('div', text, 'workbench-empty');}
  function matches(value) {const keyword = search.value.trim().toLowerCase(); return !keyword || JSON.stringify(value).toLowerCase().includes(keyword);}
  function artifactExists(path) {return artifacts.some(item => item.path === path);}
  function artifactHref(path) {return path.startsWith('artifacts/') ? '../' + path.slice('artifacts/'.length).split('/').map(encodeURIComponent).join('/') : '../../' + path.split('/').map(encodeURIComponent).join('/');}
  function fileLink(path, label, primary = false) {const link = node('a', label, 'button small' + (primary ? ' primary' : '')); link.href = artifactHref(path); link.target = '_blank'; link.rel = 'noopener'; return link;}
  function showToast(message) {let toast = document.getElementById('workbench-toast'); if (!toast) {toast = node('div', null, 'toast'); toast.id = 'workbench-toast'; toast.setAttribute('role', 'status'); document.body.append(toast);} toast.textContent = message; toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => {toast.hidden = true;}, 2800);}
  function download(name, text, type = 'application/json;charset=utf-8') {
    const link = node('a'); link.download = name;
    if (text.length < 1000000) {
      link.href = 'data:' + type + ',' + encodeURIComponent(text);
      document.body.append(link); link.click(); link.remove(); return;
    }
    const blob = new Blob([text], {type});
    const url = URL.createObjectURL(blob); link.href = url;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function requirementLink(req) {const button = node('button', req.requirement_id + ' · ' + req.title, 'source-link'); button.type = 'button'; button.addEventListener('click', () => {search.value = req.requirement_id; statusInput.value = ''; navigate('modules');}); return button;}
  function navigate(view) {if (!validViews.has(view)) return; active = view; history.replaceState(null, '', '#' + view); render(); document.getElementById('page-title').focus();}
  function pendingQuestions() {return requirements.flatMap(req => (req.pending_questions || []).map(question => ({req, question})));}

  function overview() {
    const definition = panel(project.project_name || project.project_id);
    definition.append(node('p', project.description || '项目定义待确认', 'project-objective'));
    badges(definition, [project.current_version, project.current_baseline_id || '尚未冻结', states[project.status] || project.status, project.generation_mode]);
    const profile = project.requirement_profile || {};
    const facts = node('div', null, 'project-facts');
    ['客户与角色', '需求范围', '约束条件'].forEach(key => {if (profile[key]) facts.append(node('span', profile[key], 'fact-chip'));});
    definition.append(facts); content.append(definition);
    const confirmed = requirements.filter(req => req.status === 'confirmed').length;
    const questions = pendingQuestions();
    const stats = node('dl', null, 'overview-stats');
    const values = [
      ['当前版本', project.current_version, project.current_baseline_id || '未冻结'],
      ['需求确认', confirmed + ' / ' + requirements.length, requirements.length + ' 条 REQ'],
      ['原话证据', evidence.length, sources.length + ' 份来源材料'],
      ['待确认', questions.length, questions.length ? '需要负责人处理' : '当前无阻塞登记'],
    ];
    values.forEach(([label, value, note]) => {const item = node('div', null, 'overview-stat'); item.append(node('dt', label), node('dd', value), node('dd', note, 'stat-note')); stats.append(item);});
    content.append(stats);
    const outputs = panel('成果与下一步');
    const rows = [
      ['materials', '会议素材', sources.length + ' 份材料 · ' + evidence.length + ' 条证据', sources.length > 0],
      ['modules', '功能模块', requirements.length + ' 条需求 · ' + confirmed + ' 条已确认', requirements.length > 0],
      ['documents', '方案文档', '项目方案 · PRD · 排期 · PPT', artifactExists('artifacts/prd.md')],
      ['prototype', '原型', artifactExists('artifacts/prototype/index.html') ? '已生成确认原型' : '待需求基线确认', artifactExists('artifacts/prototype/index.html')],
      ['technical', '技术设计', technical ? '候选技术决策与业务模型' : '待生成', Boolean(technical)],
      ['review', '评审记录', questions.length ? questions.length + ' 个问题待确认' : '查看评审与修订', true],
    ];
    rows.forEach(([view, label, summary, ready]) => {const button = node('button', null, 'output-row'); button.type = 'button'; button.dataset.ready = String(Boolean(ready)); const title = node('strong'); title.append(node('i', null, 'stage-dot'), node('span', label)); button.append(title, node('span', ready ? summary : '暂无')); button.addEventListener('click', () => navigate(view)); outputs.append(button);});
    content.append(outputs);
    if (questions.length) {
      const next = panel('待确认问题');
      questions.slice(0, 5).forEach(({req, question}) => {const button = node('button', null, 'question-row'); button.type = 'button'; button.append(node('span', req.requirement_id + ' · ' + question), node('span', '→')); button.addEventListener('click', () => {search.value = req.requirement_id; navigate('modules');}); next.append(button);});
      content.append(next);
    }
  }

  function materials() {
    if (!sources.length) {content.append(empty('暂无会议素材')); return;}
    const layout = node('div', null, 'selection-layout');
    const list = node('nav', null, 'selection-list'); list.setAttribute('aria-label', '来源材料');
    const detail = node('div', null, 'selection-detail');
    sources.forEach(source => {const button = node('button', null, 'selection-button'); button.type = 'button'; button.dataset.source = source.source_id; button.append(node('strong', source.file_name || source.source_name || source.source_id), node('span', (source.source_type || '材料') + ' · ' + segments.filter(item => item.source_id === source.source_id).length + ' 段')); if (source.source_id === selectedSource) button.setAttribute('aria-current', 'true'); button.addEventListener('click', () => {selectedSource = source.source_id; render();}); list.append(button);});
    const source = sources.find(item => item.source_id === selectedSource) || sources[0];
    const card = panel(source.file_name || source.source_name || source.source_id);
    badges(card, [source.source_type, source.processing_status, source.meeting_id, source.file_hash ? 'SHA-256 ' + source.file_hash.slice(0, 12) + '…' : '哈希待确认']);
    const related = evidence.filter(item => item.source_id === source.source_id && matches(item) && (!evidenceInput.value || item.evidence_level === evidenceInput.value));
    card.append(node('p', related.length + ' / ' + evidence.filter(item => item.source_id === source.source_id).length + ' 条证据匹配当前筛选', 'inline-note'));
    if (!related.length) card.append(empty('没有匹配的原话证据'));
    related.forEach(item => {
      const segment = segmentMap.get(item.segment_id) || {};
      const excerpt = node('details', null, 'source-excerpt'); excerpt.id = 'evidence-' + item.evidence_id;
      const summary = node('summary'); summary.textContent = item.original_quote; excerpt.append(summary);
      const quote = node('blockquote', item.original_quote, 'source-quote'); excerpt.append(quote);
      const time = item.start_time === null || item.start_time === undefined ? '段落 ' + display(segment.paragraph) : Math.floor(item.start_time / 60) + ':' + String(Math.floor(item.start_time % 60)).padStart(2, '0');
      badges(excerpt, [item.evidence_id, evidenceNames[item.evidence_level] || item.evidence_level, segment.speaker_id || '说话人未标记', time, item.is_inferred ? '推断内容' : '非推断原话']);
      const linked = requirements.filter(req => (req.evidence_ids || []).includes(item.evidence_id));
      linked.forEach(req => excerpt.append(requirementLink(req)));
      card.append(excerpt);
    });
    detail.append(card); layout.append(list, detail); content.append(layout);
  }

  function requirementCard(req) {
    const card = node('article', null, 'requirement-card'); card.id = req.requirement_id;
    const head = node('div', null, 'workbench-meta');
    const evidenceTag = node('span', req.evidence_level, 'evidence-tag'); evidenceTag.dataset.level = req.evidence_level;
    const statusTag = node('span', states[req.status] || req.status, 'status-tag'); statusTag.dataset.status = req.status;
    head.append(evidenceTag, statusTag, node('span', req.priority || '优先级待确认'), node('span', req.requirement_id, 'requirement-code')); card.append(head);
    card.append(node('h2', req.title));
    card.append(node('p', req.description || '需求描述待确认'));
    fields(card, [['角色', req.customer_role], ['场景', req.business_scenario], ['触发', req.trigger], ['目标', req.expected_result], ['版本', req.version]]);
    const details = node('details'); const summary = node('summary', '用户故事、业务规则、异常、验收与证据'); details.append(summary);
    if (req.user_story) {details.append(node('h3', '用户故事'), node('p', req.user_story));}
    for (const [label, key] of [['输入', 'inputs'], ['输出', 'outputs'], ['业务规则', 'business_rules'], ['异常处理', 'exceptions'], ['范围', 'scope'], ['约束', 'constraints'], ['依赖', 'dependencies'], ['验收标准', 'acceptance_criteria']]) {
      if ((req[key] || []).length) {details.append(node('h3', label), valueNode(req[key]));}
    }
    details.append(node('h3', 'Evidence'));
    (req.evidence_ids || []).forEach(id => {const item = evidenceMap.get(id); const anchor = node('a', id + (item ? ' · ' + item.original_quote : ' · 来源缺失'), 'source-link'); anchor.href = '#evidence-' + id; anchor.addEventListener('click', event => {event.preventDefault(); selectedSource = item?.source_id || selectedSource; navigate('materials'); setTimeout(() => {const target = document.getElementById('evidence-' + id); if (target) {target.open = true; target.scrollIntoView({block: 'center'});}}, 0);}); details.append(anchor);});
    if ((req.pending_questions || []).length) {details.append(node('h3', '待确认'), valueNode(req.pending_questions));}
    details.append(node('p', '整条锁定：' + Boolean(req.locked_by_human) + ' · 字段锁定：' + ((req.locked_fields || []).join('、') || '无'), 'inline-note'));
    card.append(details);
    const editor = node('div', null, 'review-editor');
    const label = node('label'); const check = node('input'); check.type = 'checkbox'; check.className = 'wb-review-check'; check.dataset.reqId = req.requirement_id; label.append(check, node('span', '纳入本次修订'));
    const note = node('textarea'); note.dataset.reqNote = req.requirement_id; note.placeholder = '填写修改、删除或补充意见；人工锁定字段仍需明确解锁'; note.setAttribute('aria-label', req.requirement_id + ' 修订意见');
    const saved = reviewSelections.get(req.requirement_id) || {}; check.checked = Boolean(saved.checked); note.value = saved.instruction || '';
    function save() {reviewSelections.set(req.requirement_id, {checked: check.checked, instruction: note.value}); updateReviewCount();}
    check.addEventListener('change', save); note.addEventListener('input', () => {if (note.value.trim()) check.checked = true; save();});
    editor.append(label, note); card.append(editor); return card;
  }
  function modules() {
    const visible = requirements.filter(req => matches(req) && (!statusInput.value || req.status === statusInput.value) && (!evidenceInput.value || req.evidence_level === evidenceInput.value));
    const summary = panel('REQ 需求卡'); summary.append(node('p', visible.length + ' / ' + requirements.length + ' 条需求；点击卡片不会更改筛选条件。', 'inline-note')); content.append(summary);
    if (!visible.length) {content.append(empty('没有匹配的需求')); return;}
    const grid = node('div', null, 'workbench-grid'); visible.forEach(req => grid.append(requirementCard(req))); content.append(grid);
  }

  function documents() {
    const docs = panel('方案与 PRD');
    const actions = node('div', null, 'document-actions');
    [['artifacts/proposal.md', '打开项目方案'], ['artifacts/proposal-full.md', '完整方案'], ['artifacts/prd.md', '阅读精简 PRD'], ['artifacts/prd-full.md', '完整 PRD'], ['artifacts/agent-prompt.md', '项目 Agent 提示词']].forEach(([path, label]) => {if (artifactExists(path)) actions.append(fileLink(path, label, path === 'artifacts/prd.md'));});
    if (!actions.children.length) docs.append(empty('尚未生成方案文档')); docs.append(actions); content.append(docs);
    const schedule = panel('排期甘特图');
    if (plan) {const items = plan.items || []; const unscheduled = items.filter(item => !item.start_date).length; badges(schedule, [plan.version, items.length + ' 个工作包', unscheduled + ' 个待排期', plan.status]); schedule.append(node('p', '日期、负责人和依赖只来自 delivery-plan；未知日期不会自动补齐。')); schedule.append(fileLink('artifacts/schedule/index.html', '打开完整排期'));} else schedule.append(empty('尚未建立交付排期'));
    content.append(schedule);
    const deck = panel('汇报 PPT');
    if (brief) {badges(deck, [brief.version, brief.review_status, brief.export_status, brief.baseline_id]); deck.append(node('p', brief.objective || '项目汇报')); deck.append(fileLink('artifacts/deck-brief.md', '打开 PPT 内容简报')); (brief.output_paths || []).forEach(path => {if (artifactExists(path)) deck.append(fileLink(path, path.endsWith('.pptx') ? '打开 PPTX 成果' : '打开 HTML deck', true));});} else deck.append(empty('PPT 简报待生成'));
    content.append(deck);
    if (changesets.length) {const changes = panel('变更记录'); changesets.forEach(item => {if (artifactExists(item)) changes.append(fileLink(item, item.split('/').at(-1)));}); content.append(changes);}
  }

  function prototype() {
    if (!artifactExists('artifacts/prototype/index.html')) {content.append(empty('原型将在确认 Baseline 后生成')); return;}
    const card = panel('已确认需求原型'); badges(card, [project.current_version, project.current_baseline_id, '示例数据', '模拟接口']); card.append(fileLink('artifacts/prototype/index.html', '在新页面打开原型', true));
    const frame = node('iframe', null, 'workbench-preview'); frame.src = '../prototype/index.html'; frame.title = '客户交互原型'; card.append(frame); content.append(card);
  }

  function technicalView() {
    const tech = panel('技术设计');
    if (!technical) tech.append(empty('技术设计待需求基线后生成'));
    else {
      tech.append(node('p', technical.summary)); badges(tech, [technical.version, technical.status, '候选设计不代表已实现']);
      if (artifactExists('artifacts/technical-design.md')) tech.append(fileLink('artifacts/technical-design.md', '打开技术设计'));
      if (artifactExists('artifacts/technical-design-full.md')) tech.append(fileLink('artifacts/technical-design-full.md', '打开完整技术设计'));
      (technical.decisions || []).forEach(item => {const card = node('article', null, 'source-excerpt'); card.append(node('h3', item.decision_id + ' · ' + item.title), node('p', item.decision)); badges(card, [item.status, (item.requirement_ids || []).join(' · '), item.rationale]); tech.append(card);});
      (technical.diagrams || []).forEach(item => {const card = node('article', null, 'source-excerpt'); card.append(node('h3', item.diagram_id + ' · ' + item.title)); badges(card, [item.diagram_type, item.status, (item.requirement_ids || []).join(' · ')]); ['spec_path', 'drawio_path', 'png_path'].forEach(key => {if (item[key] && artifactExists(item[key])) card.append(fileLink(item[key], key === 'spec_path' ? 'Mermaid 输入' : key === 'drawio_path' ? 'draw.io' : 'PNG'));}); tech.append(card);});
    }
    content.append(tech);
    const flows = panel('核心业务流程');
    (model.workflows || []).forEach(flow => {const card = node('article', null, 'source-excerpt'); card.append(node('h3', flow.name)); const steps = node('div', null, 'flow-steps'); (flow.steps || []).forEach((step, index) => {if (index) steps.append(node('span', '→', 'flow-arrow')); steps.append(node('span', step, 'flow-step'));}); card.append(steps); badges(card, [(flow.requirement_ids || []).join(' · ')]); flows.append(card);});
    if (!(model.workflows || []).length) flows.append(empty('业务流程待确认')); content.append(flows);
    const entities = panel('业务实体与字段');
    const rows = model.entities || [];
    if (rows.length) {const scroll = node('div', null, 'data-table-scroll'); const table = node('table', null, 'data-table'); const thead = node('thead'); const head = node('tr'); ['实体', '字段与依据', '关联 REQ'].forEach(label => head.append(node('th', label))); thead.append(head); const body = node('tbody'); rows.forEach(entity => {const row = node('tr'); row.append(node('td', entity.name)); const fieldText = (entity.fields || []).map(field => typeof field === 'string' ? field : (field.name || 'TBD') + '（' + (field.status || 'TBD') + '）').join('、'); row.append(node('td', fieldText), node('td', (entity.requirement_ids || []).join('、'))); body.append(row);}); table.append(thead, body); scroll.append(table); entities.append(scroll);} else entities.append(empty('业务实体待确认'));
    content.append(entities);
    const dependencies = panel('集成与依赖');
    (model.integrations || []).forEach(item => {const row = node('div', null, 'source-excerpt'); row.append(node('strong', item.name), node('p', item.status)); dependencies.append(row);});
    if (!(model.integrations || []).length) dependencies.append(empty('暂无登记的集成依赖')); content.append(dependencies);
  }

  function reviewPackageRecords() {return [...reviewSelections.entries()].filter(([, value]) => value.checked || value.instruction.trim()).map(([requirement_id, value]) => ({requirement_id, instruction: value.instruction.trim(), preserve_human_locks: true}));}
  function buildReviewPackage() {return {schema_version: '1.0', review_package_type: 'req_revision', project_id: project.project_id, base_version: project.current_version, baseline_id: project.current_baseline_id, created_at: new Date().toISOString(), global_note: document.getElementById('review-global-note')?.value.trim() || '', records: reviewPackageRecords(), instruction: '将所选 REQ 和意见转为候选 ChangeSet；保护人工锁定，未经批准不得更新 Baseline。'};}
  function updateReviewCount() {const count = document.getElementById('review-selected-count'); if (count) count.textContent = '已选择 ' + reviewPackageRecords().length + ' 条 REQ';}
  function openPrompt() {
    let dialog = document.getElementById('agent-prompt-dialog');
    if (!dialog) {dialog = node('dialog', null, 'prompt-dialog'); dialog.id = 'agent-prompt-dialog'; const head = node('header', null, 'prompt-head'); head.append(node('h2', '项目执行 Agent 提示词')); const close = node('button', '关闭', 'button small'); close.type = 'button'; close.addEventListener('click', () => dialog.close()); head.append(close); const body = node('div', null, 'prompt-body'); const text = node('textarea', null, 'prompt-text'); text.readOnly = true; text.value = data.agent_prompt || '尚未生成 Agent 提示词'; text.setAttribute('aria-label', '项目 Agent 提示词'); const actions = node('div', null, 'document-actions'); const copy = node('button', '复制完整提示词', 'button primary'); copy.type = 'button'; copy.addEventListener('click', async () => {try {await navigator.clipboard.writeText(text.value); showToast('完整 Agent 提示词已复制');} catch {text.focus(); text.select(); showToast('已全选，请按 Ctrl+C 复制');}}); const save = node('button', '下载 Markdown', 'button'); save.type = 'button'; save.addEventListener('click', () => download(project.project_id + '-agent-prompt.md', text.value, 'text/markdown;charset=utf-8')); actions.append(copy, save); body.append(text, actions); dialog.append(head, body); document.body.append(dialog);}
    dialog.showModal();
  }
  function review() {
    const questions = pendingQuestions();
    const layout = node('div', null, 'review-layout');
    const pending = panel('待确认清单');
    if (!questions.length) pending.append(empty('当前没有登记的待确认问题'));
    questions.forEach(({req, question}) => {const row = node('div', null, 'question-row'); row.append(node('span', req.requirement_id + ' · ' + question)); pending.append(row);}); layout.append(pending);
    const timeline = panel('评审记录');
    (reviews.records || []).slice().reverse().forEach(record => {const item = node('div', null, 'timeline-item'); item.append(node('strong', (record.action || 'record') + ' · ' + (record.actor || 'unknown')), node('p', record.note || record.decision || record.reason || ''), node('time', record.at || '')); timeline.append(item);});
    if (!(reviews.records || []).length) timeline.append(empty('暂无评审记录')); layout.append(timeline); content.append(layout);
    const revision = panel('二次生成复核包'); revision.append(node('p', '在“功能模块”勾选 REQ 并填写意见。导出只生成候选输入，不直接修改需求、锁定或 Baseline。'));
    const globalNote = node('textarea', null, 'review-global-note'); globalNote.id = 'review-global-note'; globalNote.placeholder = '整体补充意见'; revision.append(globalNote);
    const actions = node('div', null, 'review-package-actions'); actions.append(node('span', '已选择 0 条 REQ', 'soft-label')); actions.lastChild.id = 'review-selected-count';
    const copy = node('button', '复制复核包', 'button'); copy.type = 'button'; copy.addEventListener('click', async () => {const value = buildReviewPackage(); if (!value.records.length && !value.global_note) {showToast('请先勾选 REQ 或填写补充意见'); return;} try {await navigator.clipboard.writeText(JSON.stringify(value, null, 2)); showToast('复核包已复制；Baseline 尚未修改');} catch {showToast('当前浏览器不允许复制，请下载复核包');}});
    const save = node('button', '下载复核包', 'button primary'); save.type = 'button'; save.addEventListener('click', () => {const value = buildReviewPackage(); if (!value.records.length && !value.global_note) {showToast('请先勾选 REQ 或填写补充意见'); return;} download(project.project_id + '-review-package.json', JSON.stringify(value, null, 2)); showToast('复核包已下载；Baseline 尚未修改');});
    const exportProject = node('button', '导出项目 JSON', 'button'); exportProject.id = 'export-project'; exportProject.type = 'button'; exportProject.addEventListener('click', () => {download(project.project_id + '-project-data.json', JSON.stringify(data, null, 2)); showToast('项目数据已导出');});
    const prompt = node('button', '生成 Agent 提示词', 'button agent-prompt-open'); prompt.type = 'button'; prompt.addEventListener('click', openPrompt);
    actions.append(copy, save, exportProject, prompt); revision.append(actions); content.append(revision); updateReviewCount();
  }

  function render() {
    document.getElementById('project-brand').textContent = project.project_name || project.project_id || '项目工作台';
    document.title = (project.project_name || '产品需求') + ' · 项目工作台';
    document.getElementById('page-title').textContent = views.find(([key]) => key === active)?.[1] || '项目工作台';
    const navigation = document.getElementById('navigation'); navigation.replaceChildren();
    views.forEach(([key, label]) => {const button = node('button', null, 'nav-button'); button.type = 'button'; button.dataset.view = key; if (key === active) button.setAttribute('aria-current', 'page'); button.append(node('i', null, 'stage-dot'), node('span', label, 'nav-label')); button.addEventListener('click', () => navigate(key)); navigation.append(button);});
    content.replaceChildren();
    ({overview, materials, modules, documents, prototype, technical: technicalView, review}[active] || overview)();
  }

  search.addEventListener('input', render);
  statusInput.addEventListener('change', render);
  evidenceInput.addEventListener('change', render);
  document.getElementById('open-search').textContent = '搜';
  document.getElementById('open-search').addEventListener('click', () => {navigate('modules'); search.focus();});
  document.getElementById('toggle-sidebar').addEventListener('click', event => {const collapsed = document.querySelector('.workspace').classList.toggle('sidebar-collapsed'); event.currentTarget.setAttribute('aria-expanded', String(!collapsed));});
  window.addEventListener('hashchange', () => {const view = location.hash.slice(1); if (validViews.has(view) && view !== active) {active = view; render();}});
  render();
})();
