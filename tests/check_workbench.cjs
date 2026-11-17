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
  if (url === '/api/review/apply') return {ok: true, json: async () => ({task: {status: 'completed'}})};
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
  assert.match(document.getElementById('page-content').textContent, /0 份待发起分析/);
  assert.match(document.getElementById('page-content').textContent, /1 份已有分析版本/);
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
  navigate('modules');
  button('修订').click();
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
  navigate('review');
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
  navigate('prototype');
  assert.equal(document.querySelector('.generation-results'), null);
  button('手机').click();
  assert.equal(document.querySelector('iframe').style.width, '390px');
  button('桌面').click();
  assert.equal(document.querySelector('iframe').style.width, '100%');
  button('生成').click();
  submit(document.getElementById('generation-version').closest('form'));
  await settle();
  assert.match(document.getElementById('page-content').textContent, /Fixture dependency unavailable/);
  navigate('technical');
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
  console.log('DOM checks passed: seven views, linked media seeking and bounds, analysis state, human unlock, review payload, generation failure, keyboard tabs, prototype validation/create/search and malformed shared fragment.');
  function submitPrototype(target) {
    target.dispatchEvent(new prototype.window.Event('submit', {cancelable: true}));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
