/* Designed prototype: shell behaviour and workbench page ↔ FR/NFR mapping. Requires jsdom.
   Usage: node tests/check_prototype.cjs <version dir with prototype_design> [<version dir without prototype>] */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM, VirtualConsole} = require('jsdom');

const run = path.resolve(process.argv[2]);
const errors = [];
const quiet = new VirtualConsole();
quiet.on('jsdomError', error => errors.push(error.message));
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

// 2. Workbench mapping
const page = new JSDOM(fs.readFileSync(path.join(run, 'workbench/index.html'), 'utf8'), {url: 'http://127.0.0.1:8765/workbench/index.html#prototype', runScripts: 'outside-only', virtualConsole: quiet});
const pw = page.window, pd = pw.document;
pw.eval(fs.readFileSync(path.join(__dirname, '../product-requirements/assets/workbench.js'), 'utf8'));
const data = JSON.parse(pd.getElementById('workbench-data').textContent);
const titles = [...pd.querySelectorAll('.prototype-layout .selection-button strong')].map(node => node.textContent);
assert.deepEqual(titles, data.project.prototype_design.pages.map(item => item.name));
const mapping = () => pd.querySelector('.prototype-mapping').textContent;
assert.match(mapping(), /查询工单/);
assert.match(mapping(), /手机号脱敏显示/);
assert.match(mapping(), /主管可在手机上查看/, 'positioning-level NFR is listed');
const frame = pd.querySelector('.prototype-frame');
assert.equal(frame.getAttribute('sandbox'), 'allow-scripts allow-forms');
assert.match(frame.getAttribute('src'), /prototype\/index\.html#tickets$/);
[...pd.querySelectorAll('.prototype-layout .selection-button')].find(node => node.textContent.startsWith('新建工单')).click();
assert.match(mapping(), /提交失败可重试/);
assert.match(frame.getAttribute('src'), /#tickets$/, 'selecting a page does not reload the frame');
pw.dispatchEvent(new pw.MessageEvent('message', {source: pw, data: {type: 'prototype:page', page_id: 'detail'}}));
assert.doesNotMatch(mapping(), /处理过程留痕/, 'messages from other windows are ignored');
pw.dispatchEvent(new pw.MessageEvent('message', {source: frame.contentWindow, data: {type: 'prototype:page', page_id: 'detail'}}));
assert.match(mapping(), /处理过程留痕/, 'navigation inside the frame updates the mapping');
assert.match(pd.querySelector('.prototype-summary').textContent, /覆盖 4 条需求/);
assert.match(pd.getElementById('page-content').textContent, /不在原型中.*高峰期服务端承载/);

// 3. Checklist when no prototype exists
if (process.argv[3]) {
  const other = path.resolve(process.argv[3]);
  const empty = new JSDOM(fs.readFileSync(path.join(other, 'workbench/index.html'), 'utf8'), {url: 'http://127.0.0.1:8765/workbench/index.html#prototype', runScripts: 'outside-only', virtualConsole: quiet});
  empty.window.eval(fs.readFileSync(path.join(__dirname, '../product-requirements/assets/workbench.js'), 'utf8'));
  const items = [...empty.window.document.querySelectorAll('.prototype-checklist li strong')].map(node => node.textContent);
  assert.deepEqual(items, ['确认功能需求', '补全验收标准', '确认非功能需求', '原型设计']);
  assert.equal(empty.window.document.querySelector('.prototype-frame'), null);
}
assert.deepEqual(errors.filter(message => !/Not implemented: (HTMLDialogElement|window.scrollTo)/.test(message)), []);
console.log('Prototype checks passed: role filtering and denied view, states, annotations, workbench mapping, frame message isolation, checklist.');
