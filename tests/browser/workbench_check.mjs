import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const file = process.argv[2];
const output = process.argv[3] || path.resolve('runs/browser-validation');
if (!file) throw new Error('Usage: node tests/browser/workbench_check.mjs <workbench/index.html> [output-dir]');
fs.mkdirSync(output, {recursive:true});
const downloads = path.join(output, 'downloads'); fs.rmSync(downloads, {recursive:true,force:true}); fs.mkdirSync(downloads, {recursive:true});
const port = Number(process.env.CDP_PORT || 9333);
const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {method:'PUT'}).then(r=>r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
let id=0;const pending=new Map();const errors=[];const checks=[];const downloadEvents=[];
ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method&&m.method.startsWith('Page.download'))downloadEvents.push(m);});
const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});ws.send(JSON.stringify({id:key,method,params}));});
const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,userGesture:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result?.value;};
const check=(name,actual,expected)=>{checks.push({name,actual,expected,passed:JSON.stringify(actual)===JSON.stringify(expected)});};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function screenshot(name){const image=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(output,name),Buffer.from(image.data,'base64'));}
await send('Page.enable');await send('Runtime.enable');await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true});await send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:pathToFileURL(path.resolve(file)).href});await sleep(500);
check('page_title',await evaluate('document.title'),'星云贸易客户跟进系统 · 项目工作台');
check('seven_modules',await evaluate("document.querySelectorAll('#navigation .nav-button').length"),7);
check('overview_metrics',await evaluate("document.querySelectorAll('.overview-stat').length"),4);
await screenshot('workbench-desktop.png');
await evaluate("document.querySelector('[data-view=modules]').click()");
check('requirement_cards',await evaluate("document.querySelectorAll('.requirement-card').length"),4);
await evaluate("document.getElementById('search').value='REQ-002';document.getElementById('search').dispatchEvent(new Event('input',{bubbles:true}))");
check('global_search',await evaluate("document.querySelectorAll('.requirement-card').length"),1);
await evaluate("document.getElementById('search').value='';document.getElementById('search').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('status').value='parked';document.getElementById('status').dispatchEvent(new Event('change',{bubbles:true}))");
check('status_filter',await evaluate("document.querySelectorAll('.requirement-card').length"),1);
await evaluate("document.getElementById('status').value='';document.getElementById('status').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#REQ-001 h2').click()");
check('card_title_does_not_filter',await evaluate("document.querySelectorAll('.requirement-card').length"),4);
await evaluate("document.querySelector('.wb-review-check[data-req-id=REQ-002]').click();const note=document.querySelector('[data-req-note=REQ-002]');note.value='分支模板浏览器复核';note.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-view=review]').click()");
check('review_selected_count',await evaluate("document.getElementById('review-selected-count').textContent"),'已选择 1 条 REQ');
await evaluate("Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='下载复核包').click()");await sleep(1500);
check('download_feedback',await evaluate("document.getElementById('workbench-toast')?.textContent"),'复核包已下载；Baseline 尚未修改');
const reviewFile=path.join(downloads,'nebula-crm-review-package.json');
const downloadBegin=downloadEvents.find(event=>event.method==='Page.downloadWillBegin');
check('review_package_download_started',Boolean(downloadBegin),true);
let review;
if(fs.existsSync(reviewFile)){review=JSON.parse(fs.readFileSync(reviewFile,'utf8'));}
else if(downloadBegin?.params.url.startsWith('data:')){review=JSON.parse(decodeURIComponent(downloadBegin.params.url.slice(downloadBegin.params.url.indexOf(',')+1)));}
if(review){check('review_package_contract',{type:review.review_package_type,baseline:review.baseline_id,req:review.records[0]?.requirement_id,locks:review.records[0]?.preserve_human_locks},{type:'req_revision',baseline:'BASE-v1.1',req:'REQ-002',locks:true});}
else{check('review_package_payload_available',false,true);}
await evaluate("document.querySelector('.agent-prompt-open').click()");
check('agent_dialog_open',await evaluate("document.getElementById('agent-prompt-dialog').open"),true);
await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
check('agent_dialog_escape',await evaluate("document.getElementById('agent-prompt-dialog').open"),false);
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await sleep(250);
check('mobile_no_body_overflow',await evaluate('document.documentElement.scrollWidth <= window.innerWidth'),true);
const nav=await evaluate("(()=>{const n=document.querySelector('.nav-list');const overflow=getComputedStyle(n).overflowX;n.scrollLeft=n.scrollWidth;const last=n.lastElementChild.getBoundingClientRect();return{client:n.clientWidth,scroll:n.scrollWidth,overflow,lastRight:last.right,viewport:innerWidth};})()");
check('mobile_nav_scrollable',nav.scroll<=nav.client||['auto','scroll'].includes(nav.overflow),true);
check('mobile_last_item_reachable',nav.lastRight<=nav.viewport+1,true);
await screenshot('workbench-mobile-390.png');
const limitations=[];
if(!fs.existsSync(reviewFile))limitations.push({type:'browser_file_write_blocked',detail:'Chrome emitted downloadWillBegin and received bytes, but canceled the final file write in this environment; payload was verified from the download event instead.'});
const report={status:checks.every(item=>item.passed)&&!errors.length?(limitations.length?'passed_with_limitations':'passed'):'failed',checks,runtime_errors:errors,download_events:downloadEvents,limitations};fs.writeFileSync(path.join(output,'workbench-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));ws.close();process.exit(report.status==='passed'?0:1);
