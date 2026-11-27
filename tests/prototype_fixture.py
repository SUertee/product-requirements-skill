"""Synthetic service-desk case: explicit host responses for FR, NFR and a designed prototype.

This stands in for the host model's structured output so the generator, checks and workbench can be
exercised end to end. It is a fixture, not a semantic extraction implementation.
"""
import copy
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'product-requirements/scripts'))
from ingest_material import ingest
from workflow import Workflow, initialize

FIXTURE = Path(__file__).parent / 'fixtures/service-desk-meeting.txt'

TICKETS_MARKUP = r"""
<div class="ui-stack">
  <div class="svc-head"><h1 class="ui-title">工单</h1><button class="ui-button primary" type="button" data-goto="create" data-roles="agent">新建工单</button></div>
  <section class="ui-card" data-req="REQ-002">
    <form class="svc-search" id="ticket-search">
      <div class="ui-field"><label for="ticket-query">主题或手机号</label><input id="ticket-query" type="search" placeholder="输入主题关键字或手机号"></div>
      <button class="ui-button" type="submit">查询</button>
    </form>
    <p class="ui-muted svc-scope" id="scope-note" data-nfr="NFR-001"></p>
    <p class="svc-placeholder" data-state="loading">正在查询…</p>
    <div class="ui-table-scroll" data-nfr="NFR-004">
      <table><thead><tr><th>编号</th><th>主题</th><th>客户手机号</th><th>负责人</th><th>状态</th><th data-roles="supervisor" data-req="REQ-003">指派给</th></tr></thead><tbody id="ticket-rows"></tbody></table>
    </div>
    <p class="svc-placeholder" data-state="empty">没有找到匹配的工单，换个关键字或手机号试试。</p>
    <nav class="svc-pager" aria-label="分页" data-nfr="NFR-003"><button class="ui-button" type="button" id="prev-page">上一页</button><span class="ui-muted" id="page-info"></span><button class="ui-button" type="button" id="next-page">下一页</button></nav>
  </section>
</div>
"""

TICKETS_SCRIPT = r"""
const me = P.data.current_agent;
const size = 5;
let index = 0;
let query = '';
const mask = phone => phone.slice(0, 3) + '****' + phone.slice(-4);
function visible() { return P.data.tickets.filter(t => P.role === 'supervisor' || t.owner === me); }
function draw() {
  const q = query.trim();
  const rows = visible().filter(t => !q || t.subject.includes(q) || t.phone.includes(q));
  const total = Math.max(1, Math.ceil(rows.length / size));
  index = Math.min(index, total - 1);
  const body = page.querySelector('#ticket-rows');
  body.replaceChildren();
  for (const t of rows.slice(index * size, index * size + size)) {
    const row = P.h('tr', {},
      P.h('td', {}, P.h('a', {href: '#detail', 'data-goto': 'detail', 'data-param-id': t.id, text: t.id})),
      P.h('td', {text: t.subject}), P.h('td', {text: mask(t.phone)}), P.h('td', {text: t.owner}),
      P.h('td', {}, P.h('span', {class: 'svc-status', 'data-status': t.status, text: t.status})));
    if (P.role === 'supervisor') {
      const select = P.h('select', {'aria-label': '指派 ' + t.id});
      for (const agent of P.data.agents) select.append(P.h('option', {value: agent, text: agent}));
      select.value = t.owner;
      select.addEventListener('change', () => {
        t.owner = select.value;
        t.log.push({time: P.data.now(), text: '主管指派给 ' + select.value});
        P.notify(t.id + ' 已指派给 ' + select.value);
        draw();
      });
      row.append(P.h('td', {}, select));
    }
    body.append(row);
  }
  page.querySelector('#page-info').textContent = rows.length ? '第 ' + (index + 1) + ' / ' + total + ' 页 · 共 ' + rows.length + ' 张' : '';
  page.querySelector('#prev-page').disabled = index === 0;
  page.querySelector('#next-page').disabled = index >= total - 1;
  page.querySelector('#scope-note').textContent = P.role === 'supervisor' ? '主管视图：全部工单' : '客服视图：只显示 ' + me + ' 负责的工单';
  P.setState(rows.length ? '' : 'empty');
}
P.data.now = () => new Date().toLocaleString('zh-CN', {hour12: false}).slice(0, 16);
page.querySelector('#ticket-search').addEventListener('submit', () => {
  query = page.querySelector('#ticket-query').value;
  index = 0;
  P.loading(400, draw);
});
page.querySelector('#prev-page').addEventListener('click', () => { index -= 1; draw(); });
page.querySelector('#next-page').addEventListener('click', () => { index += 1; draw(); });
P.onShow('tickets', draw);
"""

CREATE_MARKUP = r"""
<section class="ui-card" data-req="REQ-001">
  <h1 class="ui-title">新建工单</h1>
  <form class="ui-stack svc-form" id="create-form">
    <div class="ui-field"><label for="subject">主题</label><input id="subject" required maxlength="80" placeholder="例如：洗衣机无法脱水"></div>
    <div class="ui-field"><label for="phone">客户手机号</label><input id="phone" required inputmode="numeric" pattern="1[0-9]{10}" placeholder="11 位手机号"></div>
    <div class="ui-field"><label for="detail">问题描述</label><textarea id="detail" rows="3"></textarea></div>
    <p class="svc-error" role="alert" data-state="error" data-nfr="NFR-005">提交失败：网络连接超时。你填写的内容已保留。<button class="ui-button" type="button" id="retry">重试提交</button></p>
    <p class="svc-placeholder" data-state="loading">正在提交…</p>
    <p class="svc-success" data-state="success">工单已创建：<a href="#detail" data-goto="detail" id="new-ticket"></a></p>
    <div class="ui-actions"><button class="ui-button primary" type="submit">提交工单</button><button class="ui-button" type="button" data-goto="tickets">取消</button></div>
    <label class="svc-demo"><input type="checkbox" id="fail-next"> 演示网络不稳定：下一次提交失败</label>
  </form>
</section>
"""

CREATE_SCRIPT = r"""
const form = page.querySelector('#create-form');
function submit() {
  if (!form.reportValidity()) return;
  const fail = page.querySelector('#fail-next');
  P.loading(500, () => {
    if (fail.checked) { fail.checked = false; P.setState('error'); return; }
    const id = 'T-' + (1000 + P.data.tickets.length + 1);
    P.data.tickets.unshift({id, subject: page.querySelector('#subject').value, phone: page.querySelector('#phone').value,
      owner: P.data.current_agent, status: '处理中', log: [{time: P.data.now(), text: P.data.current_agent + ' 创建工单'}]});
    const link = page.querySelector('#new-ticket');
    link.textContent = id; link.dataset.paramId = id;
    form.reset();
    P.setState('success');
    P.notify('工单 ' + id + ' 已创建');
  });
}
form.addEventListener('submit', submit);
page.querySelector('#retry').addEventListener('click', submit);
"""

DETAIL_MARKUP = r"""
<div class="ui-stack">
  <div><button class="ui-button" type="button" data-goto="tickets">← 返回工单</button></div>
  <section class="ui-card svc-denied" data-state="denied">这张工单不归你负责，客服只能查看自己负责的工单。</section>
  <div class="ui-stack" id="detail-main">
    <section class="ui-card" data-req="REQ-004">
      <div class="svc-head"><h1 class="ui-title" id="detail-title"></h1><span class="svc-status" id="detail-status"></span></div>
      <dl class="svc-meta" id="detail-meta"></dl>
      <form class="ui-stack" id="note-form">
        <div class="ui-field"><label for="note">处理备注</label><textarea id="note" rows="3" required></textarea></div>
        <div class="ui-actions"><button class="ui-button" type="submit">追加备注</button><button class="ui-button primary" type="button" id="resolve">标记已解决</button></div>
      </form>
    </section>
    <section class="ui-card" data-nfr="NFR-006"><h2>处理记录</h2><ol class="svc-timeline" id="detail-log"></ol></section>
  </div>
  <dialog class="svc-dialog" id="resolve-dialog"><h2>标记为已解决？</h2><p>操作人和时间会写入处理记录。</p><div class="ui-actions"><button class="ui-button" type="button" id="resolve-cancel">取消</button><button class="ui-button primary" type="button" id="resolve-ok">确认</button></div></dialog>
</div>
"""

DETAIL_SCRIPT = r"""
let ticket = null;
const actor = () => P.role === 'supervisor' ? '主管' : P.data.current_agent;
function draw() {
  const main = page.querySelector('#detail-main');
  if (P.role !== 'supervisor' && ticket.owner !== P.data.current_agent) { main.hidden = true; P.setState('denied'); return; }
  main.hidden = false;
  page.querySelector('#detail-title').textContent = ticket.id + ' · ' + ticket.subject;
  const status = page.querySelector('#detail-status'); status.textContent = ticket.status; status.dataset.status = ticket.status;
  const meta = page.querySelector('#detail-meta'); meta.replaceChildren();
  for (const [label, value] of [['客户手机号', ticket.phone.slice(0, 3) + '****' + ticket.phone.slice(-4)], ['负责人', ticket.owner]]) meta.append(P.h('dt', {text: label}), P.h('dd', {text: value}));
  page.querySelector('#resolve').disabled = ticket.status === '已解决';
  const log = page.querySelector('#detail-log'); log.replaceChildren();
  for (const entry of [...ticket.log].reverse()) log.append(P.h('li', {}, P.h('time', {text: entry.time}), P.h('span', {text: entry.text})));
}
P.onShow('detail', (_, params) => {
  ticket = P.data.tickets.find(t => t.id === params.id) || ticket || P.data.tickets[0];
  draw();
});
page.querySelector('#note-form').addEventListener('submit', () => {
  const note = page.querySelector('#note');
  if (!note.reportValidity()) return;
  ticket.log.push({time: P.data.now(), text: actor() + '：' + note.value});
  note.value = '';
  draw();
});
const dialog = page.querySelector('#resolve-dialog');
page.querySelector('#resolve').addEventListener('click', () => dialog.showModal());
page.querySelector('#resolve-cancel').addEventListener('click', () => dialog.close());
page.querySelector('#resolve-ok').addEventListener('click', () => {
  ticket.status = '已解决';
  ticket.log.push({time: P.data.now(), text: actor() + ' 标记为已解决'});
  dialog.close();
  P.notify(ticket.id + ' 已解决，操作已记录');
  draw();
});
"""

CSS = r"""
.svc-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}
.svc-head .ui-title{margin:0}
.svc-search{display:flex;flex-wrap:wrap;align-items:end;gap:12px;margin-bottom:8px}
.svc-search .ui-field{flex:1;min-width:200px}
.svc-scope{margin:0 0 12px}
.svc-status{display:inline-block;padding:2px 10px;border-radius:var(--ui-radius-pill);font-size:var(--ui-text-xs);background:var(--ui-warning-soft);color:var(--ui-warning)}
.svc-status[data-status="已解决"]{background:var(--ui-success-soft);color:var(--ui-success)}
.svc-pager{display:flex;align-items:center;justify-content:flex-end;gap:12px;margin-top:12px}
.svc-placeholder{padding:20px;text-align:center;color:var(--ui-muted)}
.svc-error{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:12px 16px;border-radius:var(--ui-radius-sm);background:var(--ui-danger-soft);color:var(--ui-danger)}
.svc-success{padding:12px 16px;border-radius:var(--ui-radius-sm);background:var(--ui-success-soft);color:var(--ui-success)}
.svc-demo{display:flex;gap:8px;align-items:center;font-size:var(--ui-text-sm);color:var(--ui-muted)}
.svc-meta{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:0 0 20px}
.svc-meta dt{color:var(--ui-muted)}.svc-meta dd{margin:0}
.svc-timeline{margin:0;padding-left:20px}.svc-timeline li{margin-bottom:10px}.svc-timeline time{display:block;font-size:var(--ui-text-xs);color:var(--ui-muted)}
.svc-dialog{width:min(420px,calc(100vw - 32px));padding:24px;border:1px solid var(--ui-border);border-radius:var(--ui-radius)}
.svc-dialog::backdrop{background:var(--ui-backdrop)}.svc-dialog h2{margin-top:0}
.svc-denied{color:var(--ui-muted);text-align:center;padding:40px 24px}
"""

AGENTS = ['张敏', '李航', '王璐']
SUBJECTS = ['洗衣机无法脱水', '冰箱冷藏不制冷', '空调遥控器失灵', '热水器漏水', '电视无信号', '洗碗机异响',
            '烤箱温度不准', '净水器滤芯更换', '油烟机噪音大', '扫地机器人不回充', '微波炉不加热', '燃气灶打不着火']


def sample_tickets():
    tickets = []
    for index, subject in enumerate(SUBJECTS):
        number = 1001 + index
        tickets.append({'id': f'T-{number}', 'subject': subject, 'phone': f'1380013{number:04d}', 'owner': AGENTS[index % 3],
                        'status': '已解决' if index % 4 == 3 else '处理中',
                        'log': [{'time': f'2026-11-{10 + index % 9:02d} 09:{index * 4:02d}', 'text': AGENTS[index % 3] + ' 创建工单'}]})
    return tickets


def service_desk_project(request, baseline, sources):
    ids = [source['source_id'] for source in sources if source.get('source_type') == 'transcript']
    project = copy.deepcopy(baseline)
    project.update(artifact_version=request['artifact_version'], baseline_version=request['baseline_version'])
    project['requirement_profile'] = {
        'customer_and_roles': '家电售后服务台的一线客服与主管', 'business_scenario': '客服接电话登记工单，主管分派并跟进处理',
        'pain_points': '工单分散，主管看不到全局，客户信息暴露', 'desired_outcomes': '工单可创建、可查询、可指派、可留痕',
        'scope': ['创建工单', '查询工单', '指派工单', '处理与解决'], 'constraints': '手机号脱敏；主管需在手机上查看',
        'integrations': None, 'evidence_and_questions': '预算与上线日期待确认'}

    def req(key, title, role, trigger, behavior, inputs, outputs, rules, exceptions, acceptance, refs):
        return {'requirement_id': key, 'title': title, 'role': role, 'trigger': trigger, 'behavior': behavior, 'inputs': inputs,
                'outputs': outputs, 'rules': rules, 'exceptions': exceptions, 'acceptance_criteria': acceptance,
                'source_refs': [ids[i] for i in refs], 'evidence_type': 'explicit', 'review_status': 'draft', 'locked_fields': []}
    project['requirements'] = [
        req('REQ-001', '创建工单', '客服', '接到客户来电', '填写主题和客户手机号后创建工单', ['主题', '客户手机号', '问题描述'], ['工单编号'],
            ['主题、手机号必填', '手机号为 11 位'], ['必填项缺失时就地提示'], '必填项校验通过后创建，并显示工单编号', [0]),
        req('REQ-002', '查询工单', '客服、主管', '在工单列表查找', '按主题关键字或手机号查询工单', ['关键字或手机号'], ['匹配工单列表'],
            ['只查询当前角色可见的工单'], ['没有结果时显示提示'], '输入主题关键字或手机号能看到匹配工单，查不到时有提示', [1]),
        req('REQ-003', '指派工单', '主管', '查看全部工单', '把工单指派给某个客服', ['工单', '客服'], ['新的负责人'],
            ['仅主管可指派'], None, '主管能在列表中改变工单负责人，并写入处理记录', [2]),
        req('REQ-004', '处理并解决工单', '客服', '打开工单详情', '追加处理备注并标记已解决', ['处理备注'], ['处理记录', '工单状态'],
            ['已解决的工单不可重复标记'], None, '详情能看到处理记录，追加备注后立即出现，标记已解决需确认', [3]),
    ]

    def nfr(key, category, title, statement, refs, treatment, evidence='explicit', requirement_ids=None):
        return {'nfr_id': key, 'category': category, 'title': title, 'statement': statement, 'source_refs': [ids[i] for i in refs],
                'evidence_type': evidence, 'review_status': 'draft', 'requirement_ids': requirement_ids or [], 'prototype_treatment': treatment}
    project['nfrs'] = [
        nfr('NFR-001', 'security', '按角色限定可见范围', '客服只能看到自己负责的工单，主管看到全部', [2],
            {'kind': 'shown', 'note': '原型提供客服／主管角色切换，列表和详情按角色过滤，越权打开详情显示无权限'}, requirement_ids=['REQ-002', 'REQ-003']),
        nfr('NFR-002', 'compatibility', '主管可在手机上查看', '一线客服用电脑，主管经常在手机上看工单', [4],
            {'kind': 'shown', 'note': '目标设备包含桌面与手机，工作台可切换手机尺寸检查列表与详情'}),
        nfr('NFR-003', 'performance', '列表分页、查询流畅', '高峰期一天上千张工单，列表需要分页，查询不能卡', [5],
            {'kind': 'shown', 'note': '列表每页 5 条并显示总数，查询时出现加载状态'}, requirement_ids=['REQ-002']),
        nfr('NFR-004', 'security', '手机号脱敏显示', '客户手机号属于敏感信息，列表中不完整显示', [6],
            {'kind': 'shown', 'note': '列表与详情只显示前三位和后四位'}),
        nfr('NFR-005', 'reliability', '提交失败可重试', '网络不稳定时，提交失败要能看到原因并重试', [7],
            {'kind': 'shown', 'note': '新建工单可演示一次提交失败，显示原因并保留已填内容，可直接重试'}, requirement_ids=['REQ-001']),
        nfr('NFR-006', 'compliance', '处理过程留痕', '解决或关闭工单要留下操作记录', [8],
            {'kind': 'shown', 'note': '指派、备注、解决都写入处理记录并显示时间与操作人'}, requirement_ids=['REQ-004']),
        nfr('NFR-007', 'performance', '高峰期服务端承载', '单日上千张工单时查询响应保持稳定', [5],
            {'kind': 'not_applicable', 'note': '原型不连接服务端，承载能力在开发阶段压测验证'}, evidence='inferred'),
    ]
    project['business_model'] = {'status': 'draft', 'entities': [{'name': 'Ticket', 'source_refs': [ids[0]], 'fields': [
        {'name': 'ticket_id', 'type': 'string'}, {'name': 'subject', 'type': 'string'}, {'name': 'phone', 'type': 'string'},
        {'name': 'owner', 'type': 'string'}, {'name': 'status', 'type': 'string'}]}], 'relations': [], 'flows': []}
    project['design_context'] = {'design_system_version': '0.4', 'product_type': '内部业务系统', 'target_devices': ['desktop', 'mobile']}
    design_pages = [
        {'page_id': 'tickets', 'name': '工单', 'purpose': '按角色查看、查询和指派工单', 'requirement_ids': ['REQ-002', 'REQ-003'],
         'nfr_ids': ['NFR-001', 'NFR-003', 'NFR-004'], 'states': ['loading', 'empty'], 'markup': TICKETS_MARKUP, 'script': TICKETS_SCRIPT, 'css': CSS},
        {'page_id': 'create', 'name': '新建工单', 'purpose': '客服接电话时登记工单', 'roles': ['agent'], 'requirement_ids': ['REQ-001'],
         'nfr_ids': ['NFR-005'], 'states': ['loading', 'error', 'success'], 'markup': CREATE_MARKUP, 'script': CREATE_SCRIPT},
        {'page_id': 'detail', 'name': '工单详情', 'purpose': '查看处理记录，追加备注并标记已解决', 'nav': False, 'requirement_ids': ['REQ-004'],
         'nfr_ids': ['NFR-006'], 'states': ['denied'], 'markup': DETAIL_MARKUP, 'script': DETAIL_SCRIPT},
    ]
    project['pages'] = [{'page_id': page['page_id'], 'name': page['name'], 'task': page['purpose'], 'requirement_ids': page['requirement_ids']} for page in design_pages]
    project['prototype_design'] = {
        'positioning': {'product_type': '内部业务系统 · 售后服务台', 'target_devices': ['desktop', 'mobile'],
                        'main_flow': '客服接电话创建工单 → 查询并处理 → 标记已解决；主管查看全部工单并指派',
                        'nfr_ids': ['NFR-002']},
        'roles': [{'role_id': 'agent', 'name': '客服 · 张敏'}, {'role_id': 'supervisor', 'name': '主管'}],
        'start_page_id': 'tickets',
        'feedback_form_url': 'https://example.feishu.cn/share/base/shrcnSyntheticForm0001',
        'sample_data': {'current_agent': '张敏', 'agents': AGENTS, 'tickets': sample_tickets()},
        'pages': design_pages,
    }
    return project


def exercise_designed(root):
    """Meeting → draft FR/NFR/design → confirm all → generate the designed prototype."""
    workspace = root / 'workspace'
    baseline = root / 'v0'
    initialize('desk', '合成验收 · 售后服务台', baseline)
    workflow = Workflow(workspace)
    job = ingest(FIXTURE, workspace, 'desk')
    task = workflow.prepare(baseline, [job['job_id']], 'v1')
    folder = Path(task['request_path']).parent
    request = json.loads(Path(task['request_path']).read_text())
    sources = [json.loads(line) for line in (folder / 'sources.jsonl').read_text().splitlines()]
    v1 = Path(workflow.complete(task['id'], service_desk_project(request, json.loads((folder / 'baseline.json').read_text()), sources))['result_dir'])
    project = json.loads((v1 / 'project.json').read_text())
    targets = [item['requirement_id'] for item in project['requirements']] + [item['nfr_id'] for item in project['nfrs']]
    notes = {'project_id': 'desk', 'artifact_version': 'v1', 'review_stage': 'definition', 'decisions': [
        {'decision_id': 'DEFINE-' + key, 'target': key, 'outcome': 'confirmed', 'artifact_version': 'v1', 'review_stage': 'definition', 'reviewer': '合成验收角色'} for key in targets]}
    v2 = Path(workflow.apply_review(v1, notes, 'v2')['result_dir'])
    generation = workflow.generate(v2, 'v3', ['prototype'])
    return {'workspace': workspace, 'v1': v1, 'v2': v2, 'v3': Path(generation['result_dir']), 'generation': generation}
