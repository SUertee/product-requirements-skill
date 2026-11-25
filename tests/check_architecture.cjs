/* Sandboxed Archify architecture frame only accepts its own bounded sizing messages. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const run = path.resolve(process.argv[2]);
const dom = new JSDOM(fs.readFileSync(path.join(run,'workbench/index.html'),'utf8'), {url:'http://127.0.0.1:8765/workbench/index.html#technical',runScripts:'outside-only'});
const w = dom.window, d = w.document;
w.eval(fs.readFileSync(path.join(__dirname,'../product-requirements/assets/workbench.js'),'utf8'));
const frame = d.querySelector('.architecture-preview');
assert(frame);
assert.equal(frame.getAttribute('sandbox'),'allow-scripts');
assert(frame.srcdoc.includes('product-requirements:architecture-size'));
assert.equal(d.querySelectorAll('#technical-panel iframe').length,1);
function resize(height, source) {w.dispatchEvent(new w.MessageEvent('message',{source,data:{type:'product-requirements:architecture-size',height}}));}
resize(1,w); assert.equal(frame.style.height,'');
resize(99999,frame.contentWindow); assert.equal(frame.style.height,'1800px');
resize(450,frame.contentWindow); assert.equal(frame.style.height,'450px');
resize(-1,frame.contentWindow); assert.equal(frame.style.height,'200px');
const payload = JSON.parse(d.getElementById('workbench-data').textContent);
const first = payload.project.technical_architecture.components[0];
const last = payload.project.technical_architecture.components.at(-1);
const detail = () => d.querySelector('.architecture-inspector');
assert.equal(detail().hidden,true,'no component card until one is picked');
assert.match(d.querySelector('.diagram-hint').textContent,/点选图中的组件/);
function select(id,source) { w.dispatchEvent(new w.MessageEvent('message',{source,data:{type:'product-requirements:architecture-select',id}})); }
select('component_'+(payload.project.technical_architecture.components.length-1),w);
assert.equal(detail().hidden,true,'messages from other windows are ignored');
select('component_999',frame.contentWindow); assert.equal(detail().hidden,true);
select('component_'+(payload.project.technical_architecture.components.length-1),frame.contentWindow);
assert.equal(detail().hidden,false);
assert.equal(detail().dataset.componentId,last.id);
assert.equal(d.querySelector('.diagram-hint'),null,'hint goes away after picking');
assert.match(detail().textContent,/开发内容/); assert.match(detail().textContent,/交付标准/);
assert.equal(d.querySelector('button[data-component-id]'), null, 'no chip row under the live diagram');
select('component_0',frame.contentWindow);
assert.equal(detail().dataset.componentId,first.id);

// Data model: compact embed, no inner toolbar, the page search drives it, fields appear only after a table is picked.
if (payload.data_model_diagram) {
  d.getElementById('tab-database').click();
  const model = d.querySelector('.data-model-frame');
  assert(model && model.srcdoc.includes('product-requirements:schema-select'));
  assert(model.srcdoc.includes('.toolbar,.panel'), 'inner search and side panel are hidden in the workbench');
  assert.equal(d.querySelector('.entity-detail'), null, 'no field card until a table is picked');
  const entity = payload.project.business_model.entities[0];
  const key = entity.entity_id || entity.name;
  w.dispatchEvent(new w.MessageEvent('message',{source:w,data:{type:'product-requirements:schema-select',id:key}}));
  assert.equal(d.querySelector('.entity-detail'), null, 'messages from other windows are ignored');
  w.dispatchEvent(new w.MessageEvent('message',{source:model.contentWindow,data:{type:'product-requirements:schema-select',id:key}}));
  assert.equal(d.querySelector('.entity-detail').dataset.entityId, key);
  assert.match(d.querySelector('.entity-detail').textContent, /字段/);
}
dom.window.close();
console.log('Architecture checks passed: distinct frame, sandbox, sizing source and height bounds.');
