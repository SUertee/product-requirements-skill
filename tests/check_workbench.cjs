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
payload.project.meetings = [{meeting_id: 'fixture-meeting', title: '测试会议', material_ids: [transcriptMaterial.material_id], highlights: [{text: '测试会议重点', status: 'decided', source_refs: [timedSource.source_id]}]}];
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
  customer_feedback: [{target: 'REQ-001', job_id: jobId, respondent: '客服主管',
    prompt: '电话必填吗？', answer: '选填', note: '有回访需求时才必填'}],
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
  assert(![...document.querySelectorAll('button')].some(item => item.textContent === '处理流程'), 'processing tab removed');
  navigate('overview');
  assert.equal(document.querySelectorAll('.overview-stat').length, 4);
  assert.match(document.querySelector('.overview-stats').textContent, /当前版本.*已迭代.*会议.*当前进度/);
  assert.equal(document.getElementById('next-action'), null);
  const handoff = document.querySelector('.output-row[data-target="handoff"]');
  assert(handoff, 'overview offers the development hand-off');
  if (!handoff.disabled) { handoff.click(); assert.match(document.querySelector('.handoff-text').textContent, /开发提示词/); }
  else assert.match(handoff.textContent, /确认需求后可生成/);
  navigate('documents');
  assert(![...document.querySelectorAll('button')].some(item => item.textContent === '开发提示词'), 'agent prompt left the documents tabs');
  assert(![...document.querySelectorAll('button')].some(item => item.textContent === '排期'), 'schedule tab removed');
  navigate('overview');
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
  assert.match(document.getElementById('page-content').textContent, /最近导入[\s\S]*(已在当前版本|待生成新版本|分析中)/);
  assert.equal(document.querySelectorAll('details').length, 0, 'import rows have no folded file lists');
  button('素材').click();
  assert.match(document.querySelector('.meeting-highlights').textContent, /测试会议重点/);
  assert.equal(document.querySelector('.workbench-toolbar').hidden, true);
  assert(document.querySelector('.selection-detail').contains(document.getElementById('meeting-search')));
  const selectedMeeting = document.getElementById('meeting-material').value;
  document.getElementById('meeting-search').value = '仅其他会议的词';
  document.getElementById('meeting-search').dispatchEvent(new window.Event('input'));
  assert.equal(document.getElementById('meeting-material').value, selectedMeeting);
  assert.match(document.querySelector('.selection-detail').textContent, /没有匹配的原话/);
  document.getElementById('meeting-search').value = '';
  document.getElementById('meeting-search').dispatchEvent(new window.Event('input'));

  assert.equal(document.querySelectorAll('.source-excerpt').length, 0);
  const sourceTime = document.querySelector('.meeting-highlight [data-source-ref]');
  sourceTime.click();
  assert(document.querySelector('.meeting-evidence .source-selected'));
  assert(document.querySelector('.meeting-highlight-selected'));
  assert.match(document.querySelector('.meeting-highlight').textContent, /已明确/);
  assert.equal(document.activeElement.id, 'meeting-evidence-title');
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
  assert(document.querySelectorAll('.meeting-evidence .source-excerpt').length <= 3);
  document.getElementById('meeting-evidence-title').dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
  assert.equal(document.querySelector('.meeting-evidence'), null);
  assert.equal(document.activeElement.dataset.sourceRef, timedSource.source_id);
  navigate('modules');
  const feedback = document.querySelector('.requirement-feedback');
  assert.match(feedback.textContent, /电话必填吗？.*选填.*有回访需求时才必填.*客服主管/);
  assert.equal(feedback.querySelector('a').getAttribute('href'), '/api/jobs/' + jobId + '/original');
  const choices = [...document.querySelectorAll('.requirement-choice')];
  choices.find(choice => choice.dataset.requirementId !== 'REQ-001').click();
  assert.equal(document.querySelector('.requirement-feedback'), null);
  document.querySelector('.requirement-choice[data-requirement-id="REQ-001"]').click();
  [...document.querySelectorAll('button')].find(item => /查看其余 \d+ 条原话/.test(item.textContent))?.click();
  const citation = [...document.querySelectorAll('[data-source-ref]')].find(node => node.dataset.sourceRef === lastSourceId);
  assert.match(citation.textContent, /查看原话/);
  citation.click();
  assert.equal(document.querySelector('.source-selected').dataset.sourceId, lastSourceId);
  assert(document.querySelector('.meeting-evidence'));
  button('打开完整逐字稿').click();
  assert.equal(document.querySelector('.source-selected').dataset.sourceId, lastSourceId);
  assert.match(document.querySelector('.transcript-paging').textContent, /2 \/ 2 页/);
  button('会议重点').click();
  assert.equal(document.querySelectorAll('.source-excerpt').length, 0);
  navigate('modules');
  button('修改内容').click();
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
  button('返回需求').click();
  assert(document.querySelector('.requirement-actions #review-comment'), 'review happens on the requirement');
  document.getElementById('review-comment').value = '合成评审：需要核对验收';
  [...document.querySelectorAll('.requirement-actions .outcome-choices button')].find(item => item.textContent === '需要修改').click();
  await settle();
  assert.equal(JSON.parse(requests.find(item => item.url === '/api/review').options.body).target, 'REQ-001');
  navigate('review');
  assert.match(document.getElementById('page-content').textContent, /合成评审：需要核对验收/);
  assert.match(document.getElementById('page-content').textContent, /本版相对.*的变化/);
  navigate('modules');
  assert(document.querySelector('.review-pending-bar'), 'pending verdicts and edits shown on the requirement page');
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
  const chapterButton = [...document.querySelectorAll('.doc-toc button')].find(item => item.textContent === '功能需求');
  chapterButton.click();
  assert.equal(chapterButton.getAttribute('aria-current'), 'true');
  const chapter = document.getElementById('doc-sec-' + [...document.querySelectorAll('.doc-toc button')].indexOf(chapterButton));
  assert.match(chapter.textContent, /REQ-001 · 创建工单/);
  assert(document.querySelectorAll('.doc-section').length >= 3, 'all chapters render in one scroll');
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
