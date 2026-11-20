/* DOM regression for a generated synthetic acceptance version. Requires jsdom. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM, VirtualConsole} = require('jsdom');

const run = path.resolve(process.argv[2]);
const repository = path.resolve(__dirname, '..');
const errors = [];
const consoleCapture = new VirtualConsole();
consoleCapture.on('jsdomError', error => errors.push(error.message));
const dom = new JSDOM(fs.readFileSync(path.join(run, 'workbench/index.html'), 'utf8'), {
  url: 'http://127.0.0.1:8765/workbench/index.html',
  runScripts: 'outside-only',
  virtualConsole: consoleCapture
});
const window = dom.window;
const document = window.document;
const payload = JSON.parse(document.getElementById('workbench-data').textContent);
const timedSource = payload.sources.find(source => source.source_type === 'transcript');
const transcriptMaterial = payload.project.materials.find(item => item.material_id === timedSource.material_id);
const recordingId = 'JOB-' + 'c'.repeat(24);
timedSource.locator = {start_seconds: 1, end_seconds: 2};
transcriptMaterial.provenance.related_job_id = recordingId;
payload.project.materials.push({material_id: 'synthetic-audio', job_id: recordingId, name: '合成录音.wav', kind: 'recording', path: 'synthetic-audio.wav', source_ids: []});
payload.attachments.push({material_id: 'synthetic-audio', path: 'materials/synthetic-audio.wav'});
payload.project.meetings = [{meeting_id: 'fixture-meeting', title: '测试会议', material_ids: [transcriptMaterial.material_id], highlights: [{text: '测试会议重点', source_refs: [timedSource.source_id]}]}];
for (let index = 0; index < 35; index++) {
  const source = {...timedSource, source_id: 'SRC-PAGING-' + index, text: '测试分页原话 ' + index, locator: {start_seconds: index + 10}};
  payload.sources.push(source);
  transcriptMaterial.source_ids.push(source.source_id);
}
payload.sources.push({...timedSource, source_id: 'OTHER-SOURCE', material_id: 'other-meeting', text: '仅其他会议的词'});
payload.project.materials.push({material_id: 'other-meeting', name: '其他会议', kind: 'transcript', source_ids: ['OTHER-SOURCE']});
const lastSourceId = 'SRC-PAGING-34';
payload.project.requirements[0].source_refs.push(lastSourceId);
document.getElementById('workbench-data').textContent = JSON.stringify(payload);
const jobId = 'JOB-' + 'a'.repeat(24);
const requests = [];
const state = {
  service: 'product-requirements-workbench/0.1',
  project_id: payload.project.project_id,
  artifact_version: payload.project.artifact_version,
  max_upload_bytes: 1024 * 1024,
  lark_cli_available: true,
  review: {revision: 0, decisions: []},
  tasks: [{id: 'AN-' + 'b'.repeat(24), kind: 'analysis', status: 'completed', version: 'v1', job_ids: [jobId]}],
  releases: [],
  jobs: [{job_id: jobId, material_id: 'fixture', name: '合成会议.txt', kind: 'transcript', status: 'ready_for_analysis', source_count: 3, files: {}, provenance: {}}]
};
window.fetch = async (url, options = {}) => {
  requests.push({url, options});
  if (url === '/api/status') return {ok: true, json: async () => state};
  if (url === '/api/review') { const entry = JSON.parse(options.body); state.review = {revision: state.review.revision + 1, decisions: [...state.review.decisions, entry]}; return {ok: true, json: async () => ({review: state.review})}; }
  if (url === '/api/review/apply') return {ok: true, json: async () => ({task: {status: 'completed'}})};
  if (url === '/api/documents') return {ok: false, json: async () => ({error: 'Document baseline changed'})};
  if (url === '/api/generate') return {ok: false, json: async () => ({error: 'Fixture dependency unavailable'})};
  throw new Error('Unexpected request ' + url);
};
function navigate(view) {
  document.querySelector(`[data-view="${view}"]`).click();
}
function button(text) {
  const result = [...document.querySelectorAll('button')].find(item => item.textContent === text);
  assert(result, 'Missing button ' + text);
  return result;
}
function change(field, value) {
  field.value = value;
  field.dispatchEvent(new window.Event('change', {bubbles: true}));
}
function submit(form) {
  form.dispatchEvent(new window.Event('submit', {cancelable: true, bubbles: true}));
}
async function settle() {
  for (let count = 0; count < 6; count++) await new Promise(resolve => setImmediate(resolve));
}
(async () => {
  window.eval(fs.readFileSync(path.join(repository, 'product-requirements/assets/workbench.js'), 'utf8'));
  await settle();
  assert.equal(document.querySelectorAll('[data-view]').length, 7);
  navigate('materials');
  button('处理流程').click();
  assert(document.querySelector('.processing-flow'));
  assert.match(document.querySelector('.processing-flow').textContent, /接收.*转写.*需求分析.*工作台/);
  button('素材').click();
  navigate('overview');
  assert.equal(document.querySelectorAll('.overview-stat').length, 4);
  assert.match(document.querySelector('.overview-stats').textContent, /当前版本.*已迭代.*会议.*当前进度/);
  assert.equal(document.getElementById('next-action'), null);
  document.querySelector('.output-row[data-target="prototype"]').click();
  assert(document.querySelector('.workbench-preview'));
  navigate('overview');
  for (const view of ['materials', 'modules', 'documents', 'prototype', 'technical', 'review']) {
    navigate(view);
    assert(document.getElementById('page-content').children.length > 0);
  }
  navigate('materials');
  assert.equal(document.querySelectorAll('details').length, 0);
  assert.equal(document.getElementById('material-file'), null);
  button('导入').click();
  assert.match(document.getElementById('page-content').textContent, /已生成分析版本/);
  button('素材').click();
  assert.match(document.querySelector('.meeting-highlights').textContent, /测试会议重点/);
  assert.equal(document.querySelector('.workbench-toolbar').hidden, true);
  assert(document.querySelector('.selection-detail').contains(document.getElementById('meeting-search')));
  const selectedMeeting = document.querySelector('.selection-list [aria-current="true"]').textContent;
  document.getElementById('meeting-search').value = '仅其他会议的词';
  document.getElementById('meeting-search').dispatchEvent(new window.Event('input'));
  assert.equal(document.querySelector('.selection-list [aria-current="true"]').textContent, selectedMeeting);
  assert.match(document.querySelector('.selection-detail').textContent, /没有匹配的原话/);
  document.getElementById('meeting-search').value = '';
  document.getElementById('meeting-search').dispatchEvent(new window.Event('input'));

  assert.equal(document.querySelectorAll('.source-excerpt').length, 0);
  button('00:01 查看原话 →').click();
  const audio = document.querySelector('.selection-detail audio');
  assert(audio, 'Linked recording should be available beside its transcript');
  assert.match(audio.src, /materials\/synthetic-audio.wav$/);
  Object.defineProperty(audio, 'readyState', {value: 0, configurable: true});
  Object.defineProperty(audio, 'duration', {value: 3, configurable: true});
  audio.load = () => {};
  button('定位录音 00:01').click();
  assert.match(document.getElementById('page-content').textContent, /正在加载录音时间信息/);
  Object.defineProperty(audio, 'readyState', {value: 1, configurable: true});
  audio.dispatchEvent(new window.Event('loadedmetadata'));
  assert.equal(audio.currentTime, 1);
  assert.equal(audio.paused, true);
  Object.defineProperty(audio, 'duration', {value: 0.5, configurable: true});
  button('定位录音 00:01').click();
  assert.match(document.getElementById('page-content').textContent, /原话时间超出录音长度/);
  assert(document.querySelectorAll('.source-excerpt').length <= 30);
  navigate('modules');
  const citation = [...document.querySelectorAll('[data-source-ref]')].find(node => node.dataset.sourceRef === lastSourceId);
  assert.match(citation.textContent, /查看原话/);
  citation.click();
  assert.equal(document.querySelector('.source-selected').dataset.sourceId, lastSourceId);
  assert.match(document.querySelector('.transcript-paging').textContent, /2 \/ 2 页/);
  button('会议重点').click();
  assert.equal(document.querySelectorAll('.source-excerpt').length, 0);
  navigate('modules');
  button('修改').click();
  const selector = document.getElementById('edit-field-REQ-001');
  change(selector, 'acceptance_criteria');
  const text = document.getElementById('edit-value-REQ-001');
  const lock = text.closest('form').querySelector('input[type="checkbox"]');
  assert.equal(text.readOnly, true);
  lock.checked = false;
  lock.dispatchEvent(new window.Event('change'));
  assert.equal(text.readOnly, false);
  text.value = '主题必填，提交后显示唯一编号';
  submit(text.closest('form'));
  button('记录评审意见').click();
  assert(document.querySelector('[aria-label="评审事项"]'));
  assert(document.querySelector('.selection-detail #review-comment'));
  document.getElementById('review-comment').value = '合成评审：需要核对验收';
  submit(document.getElementById('review-comment').closest('form'));
  await settle();
  assert.equal(JSON.parse(requests.find(item => item.url === '/api/review').options.body).target, 'REQ-001');
  button('已记录').click();
  assert.match(document.getElementById('page-content').textContent, /合成评审：需要核对验收/);
  button('版本变更').click();
  assert.match(document.getElementById('page-content').textContent, /当前版本/);
  button('待确认').click();
  submit(document.getElementById('review-version').closest('form'));
  await settle();
  const applied = requests.find(item => item.url === '/api/review/apply');
  assert(applied);
  assert.deepEqual(JSON.parse(applied.options.body).changes, [
    {target: 'REQ-001', field: 'acceptance_criteria', value: '主题必填，提交后显示唯一编号'},
    {target: 'REQ-001', field: 'locked_fields', value: []}
  ]);
  navigate('documents');
  assert(document.querySelectorAll('.selection-list button').length >= 3);
  button('PRD').click();
  [...document.querySelectorAll('.selection-list button')].find(item => item.textContent === '功能需求').click();
  assert.match(document.querySelector('.selection-detail').textContent, /REQ-001/);
  assert.equal(document.querySelectorAll('.document-body h4').length, 1);
  assert.equal(document.querySelector('.document-entry-picker [aria-pressed="true"]').textContent, 'REQ-001 · 创建工单');
  assert.equal(document.querySelectorAll('details').length, 0);
  button('编辑本节').click();
  const editor = document.getElementById('document-editor');
  editor.value += '\n保存失败后保留的本地修改';
  editor.dispatchEvent(new window.Event('input'));
  button('保存新版本').click();
  await settle();
  assert.match(document.getElementById('document-editor').value, /保存失败后保留的本地修改/);
  assert.match(document.getElementById('page-content').textContent, /Document baseline changed/);
  const saved = JSON.parse(requests.find(item => item.url === '/api/documents').options.body);
  assert.equal(saved.document, 'prd.md');
  assert.equal(saved.base_sha256, payload.artifacts.find(item => item.path === 'prd.md').sha256);
  assert.match(saved.content, /保存失败后保留的本地修改/);
  const append = document.body.append.bind(document.body);
  let printCalled = false;
  document.body.append = (...nodes) => {
    append(...nodes);
    for (const node of nodes) if (node.classList?.contains('document-print-frame')) {
      node.contentWindow.focus = () => {};
      node.contentWindow.print = () => { printCalled = true; };
    }
  };
  button('打印 / PDF').click();
  assert(printCalled);
  const printed = document.querySelector('.document-print-frame');
  assert.match(printed.contentDocument.body.textContent, /原始依据/);
  assert.match(printed.contentDocument.body.textContent, /保存失败后保留的本地修改/);
  printed.contentWindow.dispatchEvent(new window.Event('afterprint'));
  assert.equal(document.querySelector('.document-print-frame'), null);
  document.body.append = append;
  navigate('prototype');
  assert.equal(document.querySelector('.generation-results'), null);
  button('手机').click();
  assert.equal(document.querySelector('iframe').style.width, '390px');
  button('桌面').click();
  assert.equal(document.querySelector('iframe').style.width, '100%');
  assert.equal(document.querySelector('[aria-label="原型视图"]'), null);
  navigate('technical');
  assert.equal(document.querySelector('[aria-label="技术设计视图"]'), null);
  assert.equal(document.querySelectorAll('#technical-panel iframe').length, 0);
  assert.match(document.getElementById('technical-panel').textContent, /技术架构待确认/);
  document.getElementById('tab-database').dispatchEvent(new window.KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
  assert.equal(document.getElementById('tab-api').getAttribute('aria-selected'), 'true');
  dom.window.close();

  const prototype = new JSDOM(fs.readFileSync(path.join(run, 'prototype/index.html'), 'utf8'), {
    url: 'http://127.0.0.1:8765/prototype/index.html#%invalid', runScripts: 'dangerously', virtualConsole: consoleCapture
  });
  const page = prototype.window.document;
  assert.equal(page.getElementById('title').textContent, '创建工单');
  const form = page.querySelector('form');
  assert.equal(form.checkValidity(), false);
  page.getElementById('field-subject').value = '退货';
  submitPrototype(form);
  assert.match(page.getElementById('screen').textContent, /DEMO-0001/);
  const navigation = new Promise(resolve => prototype.window.addEventListener('hashchange', resolve, {once: true}));
  prototype.window.location.hash = 'list';
  await navigation;
  assert.equal(page.getElementById('title').textContent, '工单列表');
  const search = page.querySelector('input[type="search"]');
  search.value = '不存在';
  search.dispatchEvent(new prototype.window.Event('input'));
  assert.match(page.getElementById('screen').textContent, /暂无匹配记录/);
  prototype.window.close();
  assert.deepEqual(errors, []);
  console.log('DOM checks passed: seven views, linked media seeking and bounds, analysis state, human unlock, review payload, direct artifact browsing, keyboard tabs, prototype validation/create/search and malformed shared fragment.');
  function submitPrototype(target) {
    target.dispatchEvent(new prototype.window.Event('submit', {cancelable: true}));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
