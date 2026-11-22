/**
 * Export an approved deck brief to editable PPTX and an HTML presentation.
 *
 * PptxGenJS is the local fallback exporter. Huashu Design remains the preferred
 * visual-design route when its complete Skill is installed. This script never
 * claims that Huashu produced the files.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
let PptxGenJS;
try {
  PptxGenJS = process.env.PPTXGENJS_MODULE
    ? require(process.env.PPTXGENJS_MODULE)
    : require('pptxgenjs');
} catch (error) {
  console.error('Missing pptxgenjs. Run npm install, or set PPTXGENJS_MODULE to an isolated installation.');
  process.exit(1);
}

function argumentsMap(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index].startsWith('--')) throw new Error(`Unexpected argument: ${argv[index]}`);
    result[argv[index].slice(2)] = argv[index + 1];
  }
  return result;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function atomicWrite(file, content) {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, content, 'utf8');
  fs.renameSync(temporary, file);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function safeFilePart(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '-');
}

function htmlDeck(project, brief) {
  const slides = brief.slides.map((slide, index) => `
    <section class="deck-slide" data-slide="${index}" ${index ? 'hidden' : ''} aria-label="第 ${index + 1} 页：${escapeHtml(slide.title)}">
      <div class="deck-kicker">${escapeHtml(project.project_name)} · ${escapeHtml(brief.version)} · ${escapeHtml(slide.slide_id)}</div>
      <h1>${escapeHtml(slide.title)}</h1>
      <p class="deck-purpose">${escapeHtml(slide.purpose)}</p>
      <div class="deck-points">
        ${slide.content.map((point, pointIndex) => `<article><span>${String(pointIndex + 1).padStart(2, '0')}</span><p>${escapeHtml(point)}</p></article>`).join('')}
      </div>
      ${slide.visual_hint ? `<p class="deck-visual">视觉建议：${escapeHtml(slide.visual_hint)}</p>` : ''}
      <footer><span>${escapeHtml(slide.requirement_ids.join(' · ') || '项目级')}</span><span>${escapeHtml(project.generation_mode || brief.audience)}</span></footer>
      <details class="speaker-notes"><summary>本页讲解提示</summary><p>${escapeHtml(slide.purpose)}</p><ul>${slide.content.map(point => `<li>${escapeHtml(point)}</li>`).join('')}</ul></details>
    </section>`).join('');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(project.project_name)} · 汇报讲解</title>
<style>
:root{font-family:Inter,"Microsoft YaHei","PingFang SC",sans-serif;color:#17243b;background:#0d1830}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 90% 0,#29477d55,transparent 38%),#0d1830}.deck-shell{max-width:1280px;margin:auto;padding:28px}.deck-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;color:#b7c8e8;font-size:13px}.deck-controls{display:flex;align-items:center;gap:10px}.deck-controls button{min-width:44px;min-height:42px;padding:8px 15px;color:#eef4ff;background:#ffffff0d;border:1px solid #ffffff24;border-radius:10px;cursor:pointer}.deck-controls button:hover{background:#ffffff18}.deck-controls button:disabled{opacity:.35;cursor:not-allowed}.deck-progress{min-width:72px;text-align:center}.deck-slide{position:relative;min-height:680px;padding:46px 54px 76px;overflow:hidden;background:linear-gradient(145deg,#f8faff,#eef3fb);border:1px solid #ffffff24;border-radius:22px;box-shadow:0 26px 70px #02081466}.deck-slide:before{content:"";position:absolute;top:0;right:0;left:0;height:8px;background:linear-gradient(90deg,#315efb,#7557e8)}.deck-kicker{color:#526eaa;font-size:11px;font-weight:700;letter-spacing:.08em}.deck-slide h1{max-width:940px;margin:20px 0 10px;color:#14294a;font-size:40px;line-height:1.25}.deck-purpose{max-width:900px;margin:0 0 28px;color:#647895;font-size:16px}.deck-points{display:grid;gap:13px;max-width:1040px}.deck-points article{display:flex;align-items:center;gap:18px;min-height:76px;padding:17px 20px;background:#ffffffdf;border:1px solid #dce5f2;border-radius:14px;box-shadow:0 5px 15px #20355808}.deck-points article>span{display:grid;place-items:center;width:38px;height:38px;flex:0 0 auto;color:#fff;background:#315efb;border-radius:11px;font-size:12px;font-weight:700}.deck-points p{margin:0;color:#2a405f;font-size:18px;line-height:1.65}.deck-visual{margin:18px 0 0;color:#7a8da9;font-size:11px}.deck-slide footer{position:absolute;right:54px;bottom:26px;left:54px;display:flex;justify-content:space-between;color:#7c8ca4;font-size:11px}.speaker-notes{margin-top:20px;color:#657a99;font-size:12px}.speaker-notes summary{display:inline-flex;min-height:36px;align-items:center;color:#315efb;font-weight:600;cursor:pointer}.speaker-notes p,.speaker-notes li{line-height:1.7}.deck-help{margin:14px 0 0;color:#8297bc;font-size:11px;text-align:center}@media(max-width:700px){.deck-shell{padding:12px}.deck-slide{min-height:620px;padding:32px 24px 74px;border-radius:16px}.deck-slide h1{font-size:29px}.deck-purpose{font-size:14px}.deck-points p{font-size:15px}.deck-points article{padding:13px;gap:12px}.deck-slide footer{right:24px;bottom:20px;left:24px;gap:10px;flex-direction:column}.deck-top{align-items:flex-start;gap:10px;flex-direction:column}.deck-controls{width:100%;justify-content:flex-end}}@media print{body{background:#fff}.deck-shell{max-width:none;padding:0}.deck-top,.deck-help,.speaker-notes{display:none}.deck-slide{display:block!important;min-height:680px;margin:0;border-radius:0;box-shadow:none;page-break-after:always}}
</style></head><body><main class="deck-shell"><header class="deck-top"><span>${escapeHtml(brief.audience)} · ${escapeHtml(brief.objective)}</span><div class="deck-controls"><button id="previous" type="button">← 上一页</button><span class="deck-progress" id="progress">1 / ${brief.slides.length}</span><button id="next" type="button">下一页 →</button></div></header>${slides}<p class="deck-help">键盘 ← → 翻页 · 每页展开“本页讲解提示” · PPTX 为可编辑文本框</p></main><script>
(function(){var current=0;var slides=Array.from(document.querySelectorAll('.deck-slide'));function show(index){current=Math.max(0,Math.min(slides.length-1,index));slides.forEach(function(slide,i){slide.hidden=i!==current});document.getElementById('progress').textContent=(current+1)+' / '+slides.length;document.getElementById('previous').disabled=current===0;document.getElementById('next').disabled=current===slides.length-1}document.getElementById('previous').addEventListener('click',function(){show(current-1)});document.getElementById('next').addEventListener('click',function(){show(current+1)});document.addEventListener('keydown',function(event){if(event.key==='ArrowLeft')show(current-1);if(event.key==='ArrowRight')show(current+1)});show(0)}());
</script></body></html>`;
}

async function main() {
  const args = argumentsMap(process.argv.slice(2));
  if (!args.project) throw new Error('Usage: node scripts/export_deck_pptx.mjs --project <project-directory>');
  const root = path.resolve(args.project);
  const project = readJson(path.join(root, 'project.json'));
  const briefPath = path.join(root, 'models', 'deck-brief.json');
  const brief = readJson(briefPath);
  if (brief.project_id !== project.project_id || brief.version !== project.current_version) {
    throw new Error('Deck brief project/version does not match current project');
  }
  if (brief.review_status !== 'approved' || !brief.baseline_id) {
    throw new Error('Deck export requires an approved brief and a frozen baseline');
  }
  if (!Array.isArray(brief.slides) || !brief.slides.length) throw new Error('Deck brief has no slides');
  for (const slide of brief.slides) {
    if (!slide.title || !slide.purpose || !Array.isArray(slide.content) || !slide.content.length) {
      throw new Error(`Incomplete slide: ${slide.slide_id || 'unknown'}`);
    }
    if (slide.content.length > 6) throw new Error(`${slide.slide_id}: split content into another slide instead of overflowing six cards`);
  }
  const outputDirectory = path.join(root, 'artifacts', 'deck');
  fs.mkdirSync(outputDirectory, {recursive: true});
  const htmlPath = path.join(outputDirectory, 'index.html');
  const pptxPath = path.join(outputDirectory, `${safeFilePart(project.project_id)}-${safeFilePart(brief.version)}.pptx`);
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'product-requirements-skill';
  pptx.company = 'product-requirements-skill';
  pptx.subject = brief.objective;
  pptx.title = `${project.project_name} · 项目汇报`;
  pptx.lang = 'zh-CN';
  pptx.theme = {headFontFace: 'Microsoft YaHei', bodyFontFace: 'Microsoft YaHei', lang: 'zh-CN'};
  pptx.defineSlideMaster({
    title: 'PROJECT_DECK',
    background: {color: 'F4F7FC'},
    objects: [
      {rect: {x: 0, y: 0, w: 13.333, h: 0.10, fill: {color: '315EFB'}, line: {color: '315EFB'}}},
      {text: {text: `${project.project_name} · ${brief.version}`, options: {x: 0.62, y: 0.28, w: 8.8, h: 0.25, fontFace: 'Microsoft YaHei', fontSize: 9, bold: true, color: '526EAA', margin: 0}}},
      {line: {x: 0.62, y: 6.93, w: 12.05, h: 0, line: {color: 'D9E2EF', width: 1}}},
    ],
    slideNumber: {x: 12.15, y: 7.05, w: 0.55, h: 0.20, fontSize: 9, color: '7B8CA5', align: 'right'},
  });
  brief.slides.forEach((item, slideIndex) => {
    const slide = pptx.addSlide('PROJECT_DECK');
    slide.background = {color: 'F4F7FC'};
    slide.addText(item.title, {x: 0.62, y: 0.72, w: 12.0, h: 0.62, fontFace: 'Microsoft YaHei', fontSize: 27, bold: true, color: '14294A', margin: 0, fit: 'shrink'});
    slide.addText(item.purpose, {x: 0.62, y: 1.43, w: 11.9, h: 0.44, fontFace: 'Microsoft YaHei', fontSize: 12, color: '647895', margin: 0, fit: 'shrink'});
    const startY = 2.08;
    const availableHeight = 4.30;
    const gap = 0.12;
    const cardHeight = (availableHeight - gap * (item.content.length - 1)) / item.content.length;
    item.content.forEach((point, pointIndex) => {
      const y = startY + pointIndex * (cardHeight + gap);
      slide.addShape(pptx.ShapeType.roundRect, {x: 0.62, y, w: 12.0, h: cardHeight, rectRadius: 0.08, fill: {color: 'FFFFFF'}, line: {color: 'DCE5F2', width: 1}});
      slide.addShape(pptx.ShapeType.ellipse, {x: 0.84, y: y + cardHeight / 2 - 0.19, w: 0.38, h: 0.38, fill: {color: '315EFB'}, line: {color: '315EFB'}});
      slide.addText(String(pointIndex + 1).padStart(2, '0'), {x: 0.84, y: y + cardHeight / 2 - 0.12, w: 0.38, h: 0.22, fontFace: 'Arial', fontSize: 9, bold: true, color: 'FFFFFF', align: 'center', margin: 0});
      slide.addText(point, {x: 1.43, y: y + 0.09, w: 10.85, h: Math.max(0.25, cardHeight - 0.18), fontFace: 'Microsoft YaHei', fontSize: item.content.length > 4 ? 14 : 17, color: '2A405F', margin: 0.03, breakLine: false, valign: 'mid', fit: 'shrink'});
    });
    if (item.visual_hint) slide.addText(`视觉建议：${item.visual_hint}`, {x: 0.62, y: 6.48, w: 10.9, h: 0.24, fontFace: 'Microsoft YaHei', fontSize: 8, italic: true, color: '7A8DA9', margin: 0, fit: 'shrink'});
    slide.addText(`${item.slide_id} · ${(item.requirement_ids || []).join(' · ') || '项目级'} · ${project.generation_mode || brief.audience}`, {x: 0.62, y: 7.04, w: 10.8, h: 0.20, fontFace: 'Microsoft YaHei', fontSize: 8, color: '7B8CA5', margin: 0, fit: 'shrink'});
    if (typeof slide.addNotes === 'function') slide.addNotes(`${item.purpose}\n${item.content.map(point => `- ${point}`).join('\n')}`);
  });
  const htmlTemporary = `${htmlPath}.tmp`;
  const pptxTemporary = `${pptxPath}.tmp.pptx`;
  try {
    fs.writeFileSync(htmlTemporary, htmlDeck(project, brief), 'utf8');
    await pptx.writeFile({fileName: pptxTemporary});
    if (!fs.statSync(pptxTemporary).size) throw new Error('PptxGenJS wrote an empty file');
    fs.renameSync(htmlTemporary, htmlPath);
    fs.renameSync(pptxTemporary, pptxPath);
  } finally {
    fs.rmSync(htmlTemporary, {force: true});
    fs.rmSync(pptxTemporary, {force: true});
  }
  const outputs = [htmlPath, pptxPath].map(file => path.relative(root, file).replaceAll(path.sep, '/'));
  brief.export_status = 'exported';
  brief.output_paths = outputs;
  brief.generator = 'pptxgenjs@4.0.1 (local fallback; not huashu-design)';
  brief.exported_at = new Date().toISOString();
  brief.validation_results = [
    'PPTX 已由 PptxGenJS 实际写入，文本框可编辑；需由 validate_project.py 复核 ZIP 结构',
    'HTML deck 已生成，包含上一页／下一页、键盘翻页和逐页讲解提示',
  ];
  atomicWrite(briefPath, `${JSON.stringify(brief, null, 2)}\n`);
  console.log(JSON.stringify({status: 'success', generator: brief.generator, slides: brief.slides.length, outputs}, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
