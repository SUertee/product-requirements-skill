/* Portable design handoff: export source templates, never the rendered user data. */
(() => {
  'use strict';
  const template = window.WORKBENCH_PREVIEW_DOCUMENT;
  if (typeof template !== 'string') return;
  const names = {home:'驿站首页',agent:'AI 核查',results:'候选事件',journey:'路线与画面',review:'核查保存',records:'核查记录'};
  const safeJSON = value => JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  const inlineScript = code => `<script>${code.replace(/<\/script/gi,'<\\/script')}<\/script>`;
  const selectedScreen = () => {
    const id = document.querySelector('#screen-switcher [aria-current="true"]')?.dataset.screen || location.hash.split('/')[1];
    return names[id] ? id : 'home';
  };
  function screenSource(screen = 'home', embedded = false) {
    if (!names[screen]) screen = 'home';
    const boot = inlineScript(`
      // Design sample only. Edit the following screen, inline CSS and App code.
      window.JOURNEY_TRACE_PREVIEW_PARAMS=${safeJSON({screen,presentation:'1',embed:embedded?'1':'0'})};
      (()=>{let shared;try{shared=parent.JOURNEY_TRACE_DESIGN_STORE;}catch{};const values=new Map();window.JOURNEY_TRACE_STORE=shared||{persistent:false,getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value))};})();`);
    return template
      .replace(/<head>/i, `<head>${boot}`)
      .replace(/<title>[^<]*<\/title>/i, `<title>驿站追迹 · ${names[screen]} · 设计源码</title>`)
      .replace('<nav class="screen-nav"', '<nav id="prototype-nav" class="screen-nav"')
      .replace(/<a class="board-link"[^>]*>[\s\S]*?<\/a>(?:<br>)?/g, '')
      .replace('href="board.html"','href="#prototype-nav"');
  }
  function boardSource(doc = document) {
    const source = window.WORKBENCH_OFFLINE_DOCUMENTS?.board || '<!doctype html>\n' + doc.documentElement.outerHTML;
    const parsed = new DOMParser().parseFromString(source, 'text/html');
    parsed.querySelectorAll('script[src],script[data-offline-board-boot]').forEach(el => el.remove());
    parsed.querySelectorAll('link[rel="stylesheet"][href*="workbench-export.css"]').forEach(el => el.remove());
    parsed.getElementById('board-export-controls')?.replaceChildren();
    const status = parsed.getElementById('board-export-status');
    if (status) status.textContent = '设计源码 · 包含六屏样式与交互';
    parsed.querySelectorAll('.phone iframe').forEach((frame, index) => {
      const input = frame.dataset.offlineApp || new URL(frame.getAttribute('src') || '', 'https://design.local/').search;
      const screen = new URLSearchParams(input).get('screen');
      if (!names[screen]) throw new Error('原型页面缺少有效的 screen 参数。');
      frame.removeAttribute('src');
      frame.removeAttribute('data-offline-app');
      frame.removeAttribute('data-offline-wired');
      frame.id = 'design-frame-' + screen;
      frame.srcdoc = screenSource(screen, true);
      frame.closest('article').id = 'design-screen-' + screen;
    });
    for (const link of parsed.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href');
      if (!href.startsWith('index.html') && !href.includes('#document/app')) continue;
      const query = href.includes('?') ? href.slice(href.indexOf('?')+1) : '';
      const screen = new URLSearchParams(query).get('screen') || 'home';
      if (!names[screen]) continue;
      link.dataset.designScreen = screen;
      link.href = '#design-screen-' + screen;
    }
    const boot = inlineScript(`
      (()=>{
        const values=new Map();window.JOURNEY_TRACE_DESIGN_STORE={persistent:false,getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value))};
        let viewer;
        document.addEventListener('click',event=>{
          const link=event.target.closest('a[data-design-screen]');if(!link)return;
          const sample=document.getElementById('design-frame-'+link.dataset.designScreen);if(!sample)return;event.preventDefault();
          if(!viewer){viewer=document.createElement('dialog');viewer.className='design-enlarged';const close=document.createElement('button');close.className='design-close';close.textContent='返回总览';close.addEventListener('click',()=>viewer.close());viewer.append(close);document.body.append(viewer);viewer.addEventListener('close',()=>viewer.querySelector('iframe')?.remove());}
          viewer.querySelector('iframe')?.remove();const frame=document.createElement('iframe');frame.title=link.getAttribute('aria-label')||'App 放大预览';frame.srcdoc=sample.srcdoc;viewer.append(frame);viewer.showModal();
        });
      })();`);
    const style = parsed.createElement('style');
    style.textContent = '.design-enlarged{width:min(420px,calc(100vw - 24px));height:min(920px,calc(100dvh - 24px));max-height:none;padding:12px;border:1px solid var(--line);border-radius:16px;background:var(--white);overflow:hidden}.design-enlarged[open]{display:flex;flex-direction:column;gap:10px}.design-enlarged::backdrop{background:rgba(17,29,45,.5)}.design-close{align-self:flex-end;min-height:44px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;color:var(--accent-ink);background:var(--soft)}.design-enlarged iframe{width:100%;flex:1;min-height:0;border:0}';
    parsed.head.append(style);
    parsed.body.insertAdjacentHTML('beforeend', boot);
    return '<!doctype html>\n' + parsed.documentElement.outerHTML;
  }
  function download(source, filename, doc = document) {
    const url = URL.createObjectURL(new Blob([source], {type:'text/html;charset=utf-8'}));
    const link = doc.createElement('a');
    link.href = url; link.download = filename;
    doc.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function showSource(source, filename, hint = '') {
    let dialog = document.getElementById('design-source-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'design-source-dialog'; dialog.className = 'design-source-dialog';
      dialog.setAttribute('aria-labelledby','design-source-title');
      dialog.innerHTML = '<header><h2 id="design-source-title">HTML 设计源码</h2><button type="button" class="button ghost small" data-source-close>关闭</button></header><label for="design-source-code">完整 HTML · 包含样式与交互</label><textarea id="design-source-code" readonly spellcheck="false" aria-describedby="design-source-hint"></textarea><footer><p id="design-source-hint" role="status"></p><button type="button" class="button primary small" data-source-download>下载 HTML</button></footer>';
      dialog.querySelector('[data-source-close]').addEventListener('click',()=>dialog.close());
      dialog.querySelector('[data-source-download]').addEventListener('click',()=>download(dialog.querySelector('textarea').value,dialog.dataset.filename));
      document.body.append(dialog);
    }
    dialog.dataset.filename = filename;
    dialog.querySelector('textarea').value = source;
    dialog.querySelector('#design-source-hint').textContent = hint || '可全选复制，或下载后交给 UI 同学编辑。';
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('textarea').focus(); dialog.querySelector('textarea').select();
  }
  async function copy(source, filename, doc = document) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(source);
      return true;
    } catch {
      const field = doc.createElement('textarea');
      field.value = source; field.readOnly = true; field.setAttribute('aria-hidden','true');
      field.style.cssText = 'position:fixed;left:-10000px;top:0';
      doc.body.append(field); field.select();
      let copied = false;
      try { copied = doc.execCommand('copy'); } catch { /* Manual source selection below. */ }
      field.remove();
      if (copied) return true;
      showSource(source,filename,'浏览器限制了自动复制，可全选源码复制或下载 HTML。');
      return false;
    }
  }
  function installControls(host, status, mode, doc = document) {
    if (!host || host.dataset.designExportReady) return;
    host.dataset.designExportReady = 'true';
    const source = () => mode === 'board' ? boardSource(doc) : screenSource(selectedScreen());
    const filename = () => `驿站追迹-${mode === 'board' ? '六屏原型' : names[selectedScreen()]}.html`;
    const subject = mode === 'board' ? '六屏' : '当前页';
    const makeButton = (label, action, primary = false) => {
      const button = doc.createElement('button');
      button.type = 'button'; button.className = 'button ' + (primary ? 'primary' : 'ghost') + ' small';
      button.textContent = label;
      button.addEventListener('click', async () => {
        try {
          button.disabled = true;
          const html = source(), name = filename();
          if (action === 'copy') {
            if (await copy(html,name,doc)) status.textContent = `${subject} HTML 已复制，包含样式与交互。`;
            else status.textContent = '已打开源码，可手动复制或下载。';
          } else if (action === 'download') {
            download(html,name,doc); status.textContent = `已下载 ${name}`;
          } else showSource(html,name);
        } catch {
          status.textContent = '源码暂未生成，请重新打开原型后重试。';
        } finally { button.disabled = false; }
      });
      return button;
    };
    host.append(makeButton(`复制${subject} HTML`,'copy',true),makeButton(`下载${subject} HTML`,'download'));
    if (mode !== 'board') host.append(makeButton('查看源码','view'));
    if (!status.textContent) status.textContent = '包含样式与交互，保存为 .html 即可打开并编辑。';
  }
  function installBoard(doc) {
    installControls(doc.getElementById('board-export-controls'),doc.getElementById('board-export-status'),'board',doc);
  }
  window.WorkbenchDesignExport = Object.freeze({screenSource,boardSource,installBoard});
  installControls(document.getElementById('prototype-export-controls'),document.getElementById('prototype-export-status'),'screen');
  installBoard(document);
})();
