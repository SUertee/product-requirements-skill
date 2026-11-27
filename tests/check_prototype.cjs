/* Designed prototype: shell behaviour and workbench page ↔ FR/NFR mapping. Requires jsdom.
   Usage: node tests/check_prototype.cjs <version dir with prototype_design> [<version dir without prototype>] */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM, VirtualConsole} = require('jsdom');

const run = path.resolve(process.argv[2]);
const errors = [];
const quiet = new VirtualConsole();
// jsdom cannot parse @container rules; the browser can, so that notice is not a page error.
quiet.on('jsdomError', error => { if (error.message !== 'Could not parse CSS stylesheet') errors.push(error.message); });
quiet.on('error', message => errors.push(String(message)));

// 1. Prototype shell
const shell = new JSDOM(fs.readFileSync(path.join(run, 'prototype/index.html'), 'utf8'), {url: 'http://127.0.0.1:8765/prototype/index.html', runScripts: 'dangerously', virtualConsole: quiet});
const w = shell.window, d = w.document;
const section = id => d.querySelector(`[data-page-id="${id}"]`);
assert.equal(w.__prototypeErrors.length, 0, JSON.stringify(w.__prototypeErrors));
assert.equal(section('tickets').hidden, false, 'start page is shown');
assert.equal([...d.querySelectorAll('#pages a')].map(a => a.dataset.page).join(), 'tickets,create', 'nav hides nav:false pages');
assert.equal(section('tickets').querySelector('th[data-req="REQ-003"]').hidden, true, 'agent cannot see the assign column');
assert.equal(section('tickets').querySelectorAll('#ticket-rows tr').length, 4, 'agent sees own tickets');
const role = d.getElementById('role');
role.value = 'supervisor'; role.dispatchEvent(new w.Event('change'));
assert.equal(section('tickets').querySelector('th[data-req="REQ-003"]').hidden, false);
assert.equal(section('tickets').querySelectorAll('#ticket-rows select').length, 5, 'supervisor assigns on a paged list');
assert.equal([...d.querySelectorAll('#pages a')].map(a => a.dataset.page).join(), 'tickets', 'role-limited page leaves the nav');
w.Prototype.go('create');
w.dispatchEvent(new w.HashChangeEvent('hashchange'));
assert.equal(d.getElementById('denied').hidden, false, 'role-limited page shows the denied view');
w.Prototype.setState('error', 'create');
assert.ok(section('create').querySelector('[data-state="error"]').hasAttribute('data-state-active'));
w.Prototype.setState('', 'create');
assert.ok(!section('create').querySelector('[data-state="error"]').hasAttribute('data-state-active'));
w.postMessage({type: 'prototype:annotate', on: true}, '*');
// Customer feedback: pick a spot on the prototype, then open the pre-filled form.
const opened = [];
w.open = (url, name, features) => { opened.push({url: new w.URL(url), features}); return null; };
w.Prototype.go('tickets');
w.dispatchEvent(new w.HashChangeEvent('hashchange'));
const feedback = d.getElementById('feedback');
assert.equal(feedback.hidden, false, 'feedback button shown for a standalone prototype');
feedback.click();
assert.equal(d.getElementById('pickbar').hidden, false, 'pick mode shows its bar');
const rowsBefore = section('tickets').querySelectorAll('#ticket-rows tr').length;
const query = d.getElementById('ticket-query');
query.dispatchEvent(new w.MouseEvent('mouseover', {bubbles: true}));
assert.ok(query.classList.contains('pt-pick-target'), 'hovered element is highlighted');
query.dispatchEvent(new w.MouseEvent('click', {bubbles: true, cancelable: true}));
assert.equal(opened.length, 1);
let form = opened[0].url;
assert.equal(form.origin + form.pathname, 'https://example.feishu.cn/share/base/shrcnSyntheticForm0001');
assert.equal(form.searchParams.get('prefill_位置'), '工单 › 主题或手机号（输入框）', 'location uses the label, not typed values');
assert.equal(form.searchParams.get('prefill_需求'), 'REQ-002', 'requirement comes from the nearest data-req');
assert.equal(form.searchParams.get('hide_项目'), '1');
assert.equal(opened[0].features, 'noopener');
assert.equal(d.getElementById('pickbar').hidden, true, 'pick mode ends after choosing');
assert.ok(!query.classList.contains('pt-pick-target'));
const firstRowLink = section('tickets').querySelector('#ticket-rows [data-goto]');
if (firstRowLink) {
  feedback.click();
  firstRowLink.dispatchEvent(new w.MouseEvent('click', {bubbles: true, cancelable: true}));
  assert.equal(w.Prototype.page, 'tickets', 'picking does not trigger the prototype action');
  assert.match(opened[1].url.searchParams.get('prefill_位置'), /^工单 › /);
}
assert.equal(section('tickets').querySelectorAll('#ticket-rows tr').length, rowsBefore);
feedback.click();
d.dispatchEvent(new w.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
assert.equal(d.getElementById('pickbar').hidden, true, 'Escape cancels picking');
const count = opened.length;
feedback.click();
d.getElementById('pick-page').click();
assert.equal(opened.length, count + 1);
assert.equal(opened[count].url.searchParams.get('prefill_位置'), '工单（整页）');

// 2. Workbench mapping
const page = new JSDOM(fs.readFileSync(path.join(run, 'workbench/index.html'), 'utf8'), {url: 'http://127.0.0.1:8765/workbench/index.html#prototype', runScripts: 'outside-only', virtualConsole: quiet});
const pw = page.window, pd = pw.document;
pw.eval(fs.readFileSync(path.join(__dirname, '../product-requirements/assets/workbench.js'), 'utf8'));
const data = JSON.parse(pd.getElementById('workbench-data').textContent);
// The page shows only the prototype: no page chips beside it, a size switch above it.
assert.equal(pd.querySelector('.prototype-layout .selection-list'), null, 'pages are switched inside the prototype');
assert.deepEqual([...pd.querySelectorAll('.device-switch button')].map(node => node.textContent.trim()), ['电脑', '平板', '手机']);
const mapping = () => pd.querySelector('.prototype-mapping').textContent;
assert.match(mapping(), /查询工单/);
assert.match(mapping(), /手机号脱敏显示/);
assert.doesNotMatch(mapping(), /主管可在手机上查看/, 'positioning-level NFRs stay out of the page card');
assert.equal(pd.querySelector('.prototype-scope'), null, 'no whole-prototype card');
const frame = pd.querySelector('.prototype-frame');
assert.equal(frame.getAttribute('sandbox'), 'allow-scripts allow-forms');
// The prototype travels inside the workbench and loads through srcdoc, opening on the selected page.
assert.equal(frame.getAttribute('src'), null);
assert.match(frame.getAttribute('srcdoc'), /dataset\.startPage="tickets"/);
assert.match(frame.getAttribute('srcdoc'), /window\.Prototype/);
const initialSrcdoc = frame.getAttribute('srcdoc');
const createId = data.project.prototype_design.pages.find(item => item.name.startsWith('新建工单')).page_id;
pw.dispatchEvent(new pw.MessageEvent('message', {source: frame.contentWindow, data: {type: 'prototype:page', page_id: createId}}));
assert.match(mapping(), /提交失败可重试/);
assert.equal(frame.getAttribute('srcdoc'), initialSrcdoc, 'following the frame does not reload it');
const specButton = [...pd.querySelectorAll('.prototype-toolbar button')].find(node => node.textContent.trim() === '设计规范');
assert.ok(pd.querySelector('.design-spec').hidden, 'the design spec is folded away by default');
specButton.click();
assert.equal(pd.querySelector('.design-spec').hidden, false);
assert.equal(pd.querySelectorAll('.design-swatches li').length, 6, 'accent, page, card, text, secondary text and border');
assert.match(pd.querySelector('.design-spec-facts').textContent, /形态.*导航.*字体.*圆角.*密度.*卡片/);
const mobile = [...pd.querySelectorAll('.device-switch button')].find(node => node.textContent.trim() === '手机');
mobile.click();
assert.equal(frame.dataset.device, 'mobile');
assert.equal(frame.style.width, '390px');
pw.dispatchEvent(new pw.MessageEvent('message', {source: pw, data: {type: 'prototype:page', page_id: 'detail'}}));
assert.doesNotMatch(mapping(), /处理过程留痕/, 'messages from other windows are ignored');
pw.dispatchEvent(new pw.MessageEvent('message', {source: frame.contentWindow, data: {type: 'prototype:page', page_id: 'detail'}}));
assert.match(mapping(), /处理过程留痕/, 'navigation inside the frame updates the mapping');

// 3. Checklist when no prototype exists
if (process.argv[3]) {
  const other = path.resolve(process.argv[3]);
  const empty = new JSDOM(fs.readFileSync(path.join(other, 'workbench/index.html'), 'utf8'), {url: 'http://127.0.0.1:8765/workbench/index.html#prototype', runScripts: 'outside-only', virtualConsole: quiet});
  empty.window.eval(fs.readFileSync(path.join(__dirname, '../product-requirements/assets/workbench.js'), 'utf8'));
  const items = [...empty.window.document.querySelectorAll('.prototype-checklist li strong')].map(node => node.textContent);
  assert.deepEqual(items, ['确认功能需求', '补全验收标准', '确认非功能需求']);
  assert.equal(empty.window.document.querySelector('.prototype-frame'), null);
  // No in-page generate button: the page hands a ready-to-paste instruction to the Skill.
  const handoff = empty.window.document.querySelector('.prototype-handoff');
  assert.ok(handoff, 'hand-off to the Skill is shown');
  assert.match(handoff.querySelector('.handoff-text').textContent, /产品需求落地」Skill.*生成可交互原型/);
  assert.equal([...empty.window.document.querySelectorAll('#page-content button')].some(node => /生成原型/.test(node.textContent)), false);
}
// 4. Non-functional requirements are reviewed on the 功能需求 page, in their own group.
{
  const nfrDom = new JSDOM(fs.readFileSync(path.join(run, 'workbench/index.html'), 'utf8'), {url: 'http://127.0.0.1:8765/workbench/index.html#modules', runScripts: 'outside-only', virtualConsole: quiet});
  nfrDom.window.eval(fs.readFileSync(path.join(__dirname, '../product-requirements/assets/workbench.js'), 'utf8'));
  const nd = nfrDom.window.document;
  assert.ok([...nd.querySelectorAll('.requirement-group')].some(node => node.textContent === '非功能需求'), 'NFR group in the requirement list');
  const choice = [...nd.querySelectorAll('.requirement-choice')].find(node => /^NFR-/.test(node.dataset.requirementId));
  choice.click();
  assert.match(nd.querySelector('.requirement-head').textContent, /NFR-/);
  assert.match(nd.querySelector('.selection-detail').textContent, /原型中怎么体现/);
}
// 5. Page-by-page review on the 原型预览 page, then the customer package without leaving it.
(async () => {
  const requests = [];
  const dom = new JSDOM(fs.readFileSync(path.join(run, 'workbench/index.html'), 'utf8'), {url: 'http://127.0.0.1:8765/workbench/index.html#prototype', runScripts: 'outside-only', virtualConsole: quiet});
  const rw = dom.window, rd = rw.document;
  const payload = JSON.parse(rd.getElementById('workbench-data').textContent);
  const state = {service: 'product-requirements-workbench/0.1', project_id: payload.project.project_id, artifact_version: payload.project.artifact_version, max_upload_bytes: 1024, lark_cli_available: false,
    review: {revision: 0, decisions: []}, tasks: [], releases: [], customer_feedback: [], jobs: []};
  rw.fetch = async (url, options = {}) => {
    requests.push({url, body: options.body ? JSON.parse(options.body) : null});
    if (url === '/api/status') return {ok: true, json: async () => state};
    if (url === '/api/review') { const entry = JSON.parse(options.body); state.review = {revision: state.review.revision + 1, decisions: [...state.review.decisions, entry]}; return {ok: true, json: async () => ({review: state.review})}; }
    if (url === '/api/release') { state.releases = [{release_id: 'REL-1', artifact_version: state.artifact_version}]; return {ok: true, json: async () => ({release: state.releases[0]})}; }
    throw new Error('Unexpected request ' + url);
  };
  rw.navigator.clipboard = {writeText: async text => { rw.copied = text; }};
  rw.eval(fs.readFileSync(path.join(__dirname, '../product-requirements/assets/workbench.js'), 'utf8'));
  const settle = async () => { for (let count = 0; count < 8; count++) await new Promise(resolve => setImmediate(resolve)); };
  await settle();
  const bar = () => rd.querySelector('.prototype-review-bar').textContent;
  const reviewButton = label => [...rd.querySelectorAll('.prototype-review-bar button, .prototype-toolbar button')].find(node => node.textContent.trim() === label);
  const pageIds = payload.project.prototype_design.pages.map(item => item.page_id);
  const reviewFrame = rd.querySelector('.prototype-frame');
  const fromFrame = message => rw.dispatchEvent(new rw.MessageEvent('message', {source: reviewFrame.contentWindow, data: message}));
  const releaseNotes = () => requests.filter(item => item.url === '/api/review').map(item => item.body);
  // Pages are fine by default: no per-page sign-off, only change requests picked on the prototype.
  assert.match(bar(), /没有修改意见/);
  assert.ok(reviewButton('确认并生成交付包'), 'the whole prototype can be confirmed without visiting every page');
  assert.equal(reviewButton('这页要改'), undefined, 'no page-level button: comments start from a picked place');
  const pick = reviewButton('提修改意见');
  pick.click();
  assert.equal(pick.getAttribute('aria-pressed'), 'true', 'picking is on until the prototype answers');
  fromFrame({type: 'prototype:picked', page_id: pageIds[0], location: '提交（按钮）'});
  assert.equal(pick.getAttribute('aria-pressed'), 'false');
  assert.match(bar(), /提交（按钮） 要改什么/, 'the form names the picked place');
  fromFrame({type: 'prototype:picked', page_id: 'nope', location: 'x'});
  assert.match(bar(), /提交（按钮）/, 'unknown pages are ignored');
  reviewButton('保存意见').click(); await settle();
  assert.equal(releaseNotes().length, 0, 'a change request needs a comment');
  rd.querySelector('.page-review-input').value = '提交后应回到详情页';
  reviewButton('保存意见').click(); await settle();
  assert.deepEqual(releaseNotes().map(item => [item.review_stage, item.target, item.outcome, item.comment]), [['release', 'prototype/index.html#' + pageIds[0], 'needs_changes', '【提交（按钮）】提交后应回到详情页']]);
  assert.match(bar(), /1 条修改意见/);
  assert.match(rd.querySelector('.prototype-notes').textContent, /› 提交（按钮）提交后应回到详情页/);
  fromFrame({type: 'prototype:picked', page_id: pageIds[0], location: '整页'});
  rd.querySelector('.page-review-input').value = '标题太长';
  reviewButton('保存意见').click(); await settle();
  assert.equal(releaseNotes().at(-1).comment, '【提交（按钮）】提交后应回到详情页\n【整页】标题太长', 'notes on one page add up');
  assert.match(bar(), /2 条修改意见/);
  reviewButton('复制修改指令').click(); await settle();
  assert.match(rw.copied, new RegExp(pageIds[0] + '）› 提交（按钮）：提交后应回到详情页'));
  assert.equal(reviewButton('确认并生成交付包'), undefined, 'no package while there are change requests');
  reviewButton('删除').click(); await settle();
  assert.equal(releaseNotes().at(-1).comment, '【整页】标题太长');
  reviewButton('删除').click(); await settle();
  assert.deepEqual([releaseNotes().at(-1).outcome, releaseNotes().at(-1).comment], ['confirmed', '撤回修改意见'], 'removing the last note withdraws the request');
  assert.match(bar(), /没有修改意见/);
  // The shell answers a workbench pick with the place instead of opening the customer form.
  const picked = new Promise(resolve => w.addEventListener('message', event => { if (event.data?.type === 'prototype:picked') resolve(event.data); }));
  w.Prototype.go('tickets'); w.dispatchEvent(new w.HashChangeEvent('hashchange'));
  w.dispatchEvent(new w.MessageEvent('message', {source: w, data: {type: 'prototype:pick', on: true}}));
  const before = opened.length;
  d.getElementById('ticket-query').dispatchEvent(new w.MouseEvent('click', {bubbles: true, cancelable: true}));
  assert.deepEqual(JSON.parse(JSON.stringify(await picked)), {type: 'prototype:picked', page_id: 'tickets', location: '主题或手机号（输入框）', requirement_ids: ['REQ-002']});
  assert.equal(opened.length, before, 'no customer form in the workbench preview');
  reviewButton('确认并生成交付包').click(); await settle();
  const last = requests.filter(item => item.url === '/api/review').pop();
  assert.deepEqual([last.body.target, last.body.outcome], ['prototype/index.html', 'confirmed'], 'the file itself is confirmed before packaging');
  assert.deepEqual(requests.find(item => item.url === '/api/release').body.files, ['prototype/index.html']);
  assert.match(bar(), /交付包已生成/);
  assert.ok(rd.querySelector('.prototype-review-bar a[href="/api/releases/REL-1/package"]'));
  finish();
})().catch(error => { console.error(error); process.exit(1); });
function finish() {
assert.deepEqual(errors.filter(message => !/Not implemented: (HTMLDialogElement|window.scrollTo)/.test(message)), []);
console.log('Prototype checks passed: role filtering and denied view, states, annotations, workbench mapping, srcdoc frame, message isolation, checklist, change requests and package.');
}
