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
dom.window.close();
console.log('Architecture checks passed: distinct frame, sandbox, sizing source and height bounds.');
