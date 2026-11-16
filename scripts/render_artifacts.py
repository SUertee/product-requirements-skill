#!/usr/bin/env python3
"""Render proposal, PRD and static HTML deliverables from shared Project Data."""
import argparse
import html
import json
from pathlib import Path

from project_lib import SKILL_ROOT, atomic_write_text, load_requirements, read_json, read_jsonl


def e(value):
    return html.escape(str(value), quote=True)


def replace_template(template, values):
    for key, value in values.items():
        template = template.replace("{{" + key + "}}", str(value))
    if "{{" in template:
        raise ValueError("Unresolved template token")
    return template


def requirement_text(requirement):
    return [
        f"### {requirement['requirement_id']} {requirement['title']}", "",
        f"- 状态：{requirement['status']}；证据等级：{requirement['evidence_level']}；优先级：{requirement.get('priority', 'TBD')}",
        f"- 角色：{requirement['customer_role']}；场景：{requirement['business_scenario']}",
        f"- 痛点：{requirement['pain_point']}",
        f"- 触发：{requirement['trigger']}；目标：{requirement['expected_result']}",
        f"- 范围：{'；'.join(requirement['scope']) or 'TBD'}",
        f"- 约束：{'；'.join(requirement['constraints']) or 'TBD'}",
        f"- 集成与依赖：{'；'.join(requirement['dependencies']) or 'TBD'}",
        f"- Evidence：{', '.join(requirement['evidence_ids'])}",
        f"- 待确认：{'；'.join(requirement.get('pending_questions', [])) or '无'}", "",
        "验收标准：", "",
        *[f"{index}. {criterion}" for index, criterion in enumerate(requirement["acceptance_criteria"], 1)], "",
    ]


def render_markdown(project, requirements, artifact):
    title = "项目方案" if artifact == "proposal" else "产品需求文档"
    lines = [
        f"# {project['project_name']} {title}", "",
        f"> 版本：{project['current_version']}；状态：{project['status']}；{project.get('generation_mode', 'Agent 分析')}。", "",
        "## 项目概述", "", project.get("description", "TBD"), "",
        f"客户：{project.get('customer', 'TBD')}。所有未提供的预算、日期和业务指标均为 TBD。", "",
        "## 用户角色与权限", "",
    ]
    roles = sorted({item["customer_role"] for item in requirements})
    lines.extend([f"- {role}" for role in roles] or ["- TBD"])
    lines.extend(["", "## 业务流程", "", "需求触发、操作与结果按下列 REQ 组织；未提供的流程分支标记 TBD。", ""])
    if artifact == "prd":
        lines.extend(["## 非功能需求", "", "TBD：原始材料未明确给出的性能、安全和兼容性指标不作推定。", ""])
    for requirement in requirements:
        lines.extend(requirement_text(requirement))
    lines.extend([
        "## 业务规则与异常处理", "",
        "规则仅来自关联 Evidence。无权限、空数据、失败重试等未明确规则列入待确认，不自动补写为客户事实。", "",
        "## 数据结构与接口集成", "",
        "业务实体见 `models/business-model.json`。外部接口均为候选或 TBD，未接通时不声明真实集成。", "",
        "## 风险与待确认", "",
    ])
    questions = [f"{item['requirement_id']}：{question}" for item in requirements for question in item.get("pending_questions", [])]
    lines.extend([f"- {question}" for question in questions] or ["- 无"])
    lines.extend(["", "## 验收与追溯", "", "每项验收与所属 REQ 使用同一文本；从 REQ 的 Evidence ID 可回查 Segment 原话和时间。", ""])
    return "\n".join(lines)


STATUS_LABELS = {"draft": "草稿", "confirmed": "已确认", "disputed": "冲突", "parked": "暂缓"}
PROJECT_STATUS_LABELS = {"draft": "草稿", "in_review": "评审中", "baselined": "已建基线", "published": "已发布"}


def short_text(value, limit=88):
    text = " ".join(str(value).split())
    return text if len(text) <= limit else text[:limit].rstrip("，。；、 ") + "…"


def format_seconds(value):
    if value is None:
        return "时间未提供"
    seconds = int(value)
    return f"{seconds // 60:02d}:{seconds % 60:02d}"


def evidence_time(item):
    if item.get("start_time") is None:
        return "时间未提供"
    start = format_seconds(item.get("start_time"))
    end = format_seconds(item["end_time"]) if item.get("end_time") is not None else "结束未提供"
    return f"{start} · {end}"


def requirement_cards(requirements):
    cards = []
    for item in requirements:
        criteria = "".join(f"<li>{e(value)}</li>" for value in item["acceptance_criteria"])
        question_values = item.get("pending_questions", [])
        questions = "".join(f"<li>{e(value)}</li>" for value in question_values)
        question_html = f"<div class='wb-req-questions'><strong>{len(question_values)} 项待确认</strong><ul>{questions}</ul></div>" if question_values else ""
        evidence_links = "".join(f"<a href='#evidence-{e(evidence_id)}'>{e(evidence_id)}</a>" for evidence_id in item["evidence_ids"])
        status = item["status"] if item["status"] in STATUS_LABELS else "draft"
        locked_fields = "、".join(item["locked_fields"]) or "无"
        cards.append(
            f"<article class='wb-requirement-card' data-status='{e(status)}' id='{e(item['requirement_id'])}'>"
            f"<div class='wb-req-head'><div><span class='wb-req-id'>{e(item['requirement_id'])}</span><h3 class='wb-req-title'>{e(item['title'])}</h3></div>"
            f"<span class='wb-status wb-status-{e(status)}'>{e(STATUS_LABELS[status])}</span></div>"
            f"<p class='wb-req-desc'>{e(item['description'])}</p>"
            f"<dl class='wb-req-facts'><div><dt>角色</dt><dd>{e(item['customer_role'])}</dd></div>"
            f"<div><dt>场景</dt><dd>{e(item['business_scenario'])}</dd></div><div><dt>触发</dt><dd>{e(item['trigger'])}</dd></div>"
            f"<div><dt>目标</dt><dd>{e(item['expected_result'])}</dd></div></dl>{question_html}"
            f"<details class='wb-req-details'><summary>验收、证据与约束</summary><h4>验收标准</h4><ol>{criteria}</ol>"
            f"<h4>约束与依赖</h4><ol>{''.join(f'<li>{e(value)}</li>' for value in item['constraints'] + item['dependencies'])}</ol>"
            f"<h4>关联 Evidence · {e(item['evidence_level'])}</h4><div class='wb-req-evidence'>{evidence_links}</div></details>"
            f"<div class='wb-req-lock'>版本 {e(item['version'])} · 整条锁定 {e(item['locked_by_human'])} · 锁定字段 {e(locked_fields)}</div></article>"
        )
    return "".join(cards)


def evidence_cards(evidence, segments, requirements):
    segment_map = {item.get("segment_id"): item for item in segments}
    related = {}
    for requirement in requirements:
        for evidence_id in requirement.get("evidence_ids", []):
            related.setdefault(evidence_id, []).append(requirement["requirement_id"])
    cards = []
    for item in evidence:
        segment = segment_map.get(item["segment_id"], {})
        speaker = segment.get("speaker_id") or "说话人未标记"
        paragraph = segment.get("paragraph")
        location = f"段落 {paragraph}" if paragraph is not None else item["segment_id"]
        req_links = "".join(f"<a href='#{e(req_id)}'>{e(req_id)}</a>" for req_id in related.get(item["evidence_id"], []))
        related_html = f"<div class='wb-related-req'><span>关联需求</span>{req_links}</div>" if req_links else ""
        inference = "推断内容" if item["is_inferred"] else "非推断原话"
        cards.append(
            f"<details class='wb-evidence-item' id='evidence-{e(item['evidence_id'])}' data-level='{e(item['evidence_level'])}'>"
            f"<summary><span class='wb-level wb-level-{e(item['evidence_level'])}'>{e(item['evidence_level'])}</span>"
            f"<div class='wb-evidence-summary'><strong>{e(short_text(item['original_quote']))}</strong><small>{e(item['evidence_id'])} · {e(speaker)} · {e(location)}</small></div>"
            f"<span class='wb-evidence-time'>{e(evidence_time(item))}</span></summary>"
            f"<div class='wb-evidence-detail'><blockquote>{e(item['original_quote'])}</blockquote>"
            f"<div class='wb-evidence-meta'><span>Segment：{e(item['segment_id'])}</span><span>来源：{e(item['source_type'])}</span><span>{e(inference)}</span>"
            f"<button class='wb-copy-btn' type='button' data-copy='{e(item['evidence_id'])}'>复制证据 ID</button></div>{related_html}</div></details>"
        )
    return "".join(cards)


def business_model_html(model):
    roles = "".join(f"<span class='wb-role-chip'>{e(role.get('name', 'TBD'))} · {e('、'.join(role.get('goals', [])) or '职责待确认')}</span>" for role in model.get("roles", []))
    role_html = f"<article class='wb-model-card'><h3>用户角色</h3><div class='wb-role-list'>{roles}</div></article>" if roles else ""
    flows = []
    for workflow in model.get("workflows", []):
        steps = "".join(f"<span class='wb-flow-step'>{e(step)}</span>" + ("<span class='wb-flow-arrow'>→</span>" if index < len(workflow.get("steps", [])) - 1 else "") for index, step in enumerate(workflow.get("steps", [])))
        unknown = "".join(f"<li>{e(value)}</li>" for value in workflow.get("unknown_branches", []))
        unknown_html = f"<div class='wb-req-questions'><strong>待确认分支</strong><ul>{unknown}</ul></div>" if unknown else ""
        req_ids = "、".join(workflow.get("requirement_ids", []))
        flows.append(f"<article class='wb-model-card'><h3>{e(workflow.get('name', '业务流程'))}</h3><div class='wb-flow'>{steps}</div><div class='wb-req-lock'>关联 {e(req_ids)}</div>{unknown_html}</article>")
    entity_rows = []
    for entity in model.get("entities", []):
        field_values = []
        for field in entity.get("fields", []):
            field_values.append(f"{field.get('name', 'TBD')}（{field.get('status', 'TBD')}）" if isinstance(field, dict) else str(field))
        entity_rows.append(f"<tr><td><strong>{e(entity.get('name', 'TBD'))}</strong></td><td>{e('、'.join(field_values) or 'TBD')}</td><td>{e('、'.join(entity.get('requirement_ids', [])))}</td></tr>")
    entities_html = f"<article class='wb-model-card'><h3>核心实体与字段</h3><div class='ui-table-scroll'><table class='wb-model-table'><thead><tr><th>实体</th><th>字段与依据</th><th>关联 REQ</th></tr></thead><tbody>{''.join(entity_rows)}</tbody></table></div></article>" if entity_rows else ""
    integrations = "".join(f"<div class='wb-integration-item'><strong>{e(item.get('name', 'TBD'))}</strong><span>{e(item.get('status', 'TBD'))} · {e('、'.join(item.get('requirement_ids', [])))}</span></div>" for item in model.get("integrations", []))
    integration_html = f"<article class='wb-model-card'><h3>集成与依赖</h3><div class='wb-integration-list'>{integrations}</div></article>" if integrations else ""
    rules = "".join(f"<li>{e(rule.get('rule', rule))} · {e(rule.get('evidence_level', 'TBD') if isinstance(rule, dict) else '')}</li>" for rule in model.get("rules", []))
    rules_html = f"<article class='wb-model-card'><h3>业务规则</h3><ol>{rules}</ol></article>" if rules else ""
    raw = e(json.dumps(model, ensure_ascii=False, indent=2))
    content = "".join(["".join(flows), role_html, entities_html, integration_html, rules_html])
    return f"<div class='wb-model-grid'>{content}</div><details class='wb-raw-data'><summary>查看完整业务模型 JSON</summary><pre>{raw}</pre></details>"


def build_agent_prompt(project, requirements, model, evidence):
    """Build a self-contained implementation prompt from current Project Data."""
    evidence_map = {item["evidence_id"]: item for item in evidence}
    lines = [
        f"# {project['project_name']} · 项目执行 Agent 提示词", "",
        "> 将本提示词复制给负责当前项目实施的 Coding Agent。内容由产品需求落地 Skill 根据当前 Project Data 生成。", "",
        "## 你的角色与目标", "",
        "你是本项目的资深全栈开发与交付 Agent。你的任务是在现有项目中审计代码、制定最小可行实施路径、实际编码、运行测试并报告真实结果，而不是只输出架构建议或伪代码。", "",
        "## 项目状态与授权边界", "",
        f"- 当前版本：{project['current_version']}",
        f"- 当前 Baseline：{project.get('current_baseline_id') or '尚未冻结'}",
        f"- 项目状态：{project['status']}",
        f"- 生成方式：{project.get('generation_mode', 'Agent 分析')}",
        "- 用户复制本提示词表示希望你开始项目实施，但不代表所有 Draft 已成为客户确认基线。",
        "- confirmed 需求可按验收执行；draft 仅实施无歧义部分并记录假设；disputed/parked 必须先澄清，不得擅自当作已确认功能。",
        "- 不得自动修改需求状态、解锁字段、冻结 Baseline 或对外发布。真实外部写入、客户数据传输和部署必须另行获得授权。", "",
        "## 强制执行原则", "",
        "1. 先读取现有仓库的 AGENTS.md、README、架构与开发规范，保留已有成果，不为套模板重写项目。",
        "2. 先建立 REQ ID → 现有模块 → 修改文件 → 测试用例的映射；REQ ID 必须稳定写入实现和测试。",
        "3. TBD、未确认指标、预算、日期、接口字段和业务规则不得编造。非关键默认值写入实施记录，关键阻塞项集中询问。",
        "4. 外部接口未接通时使用清晰的 Adapter/Mock 边界并标注模拟状态；不得把 Mock 说成真实联调成功，不得硬编码密钥。",
        "5. 优先完成一条可操作的端到端主流程，再扩展相邻能力；允许局部完成，不因为单个可选字段缺失丢弃全部成果。",
        "6. 每个模块完成后运行相关测试；最终执行单元、集成和主流程验证。未执行的检查必须明确写未验证。",
        "7. 保留人工锁定内容，不覆盖他人已有修改。任何实现与需求冲突时，回到 Evidence 和验收标准核对。", "",
        "## 项目背景", "",
        project.get("description", "TBD"), "",
        f"客户：{project.get('customer', 'TBD')}", "",
        "## 共享业务模型", "",
        f"```json\n{json.dumps(model, ensure_ascii=False, indent=2)}\n```", "",
        "## 需求、验收与原话证据", "",
    ]
    for item in requirements:
        lines.extend([
            f"### {item['requirement_id']} · {item['title']}", "",
            f"- 状态：{item['status']}；证据等级：{item['evidence_level']}；版本：{item['version']}",
            f"- 描述：{item['description']}",
            f"- 角色：{item['customer_role']}",
            f"- 业务场景：{item['business_scenario']}",
            f"- 触发：{item['trigger']}",
            f"- 目标结果：{item['expected_result']}",
            f"- 范围：{'；'.join(item['scope']) or 'TBD'}",
            f"- 约束：{'；'.join(item['constraints']) or 'TBD'}",
            f"- 依赖：{'；'.join(item['dependencies']) or 'TBD'}",
            f"- 人工锁定：整条={item['locked_by_human']}；字段={', '.join(item['locked_fields']) or '无'}", "",
            "验收标准：", "",
            *[f"{index}. {criterion}" for index, criterion in enumerate(item["acceptance_criteria"], 1)], "",
        ])
        if item.get("pending_questions"):
            lines.append("待确认：")
            lines.extend([f"- {question}" for question in item["pending_questions"]])
            lines.append("")
        lines.append("原话证据：")
        for evidence_id in item["evidence_ids"]:
            source = evidence_map.get(evidence_id)
            if source:
                lines.append(f"- [{evidence_id} / {source['evidence_level']}] {source['original_quote']}")
            else:
                lines.append(f"- [{evidence_id}] 来源记录缺失，实施前必须核查")
        lines.append("")
    lines.extend([
        "## 建议执行顺序", "",
        "1. 输出简短的现状审计、需求实现映射、关键阻塞和实施计划。",
        "2. 先解决影响主链路的接口合同与关键歧义；无关键阻塞时不要停在计划阶段，直接继续实现。",
        "3. 以共享 REQ 和验收标准驱动后端、前端、交互和测试，不让不同模块各自发明规则。",
        "4. 实现正常、空态、错误、权限与关键异常路径；没有依据的规则保持 TBD 或明确标为建议。",
        "5. 运行测试并检查实际页面或接口。失败则修复后重跑，不通过截图、文档或编译成功冒充端到端完成。", "",
        "## 最终回复格式", "",
        "- 已完成模块及对应 REQ ID。",
        "- 实际修改的文件和关键实现。",
        "- 实际运行的测试、结果和可演示入口。",
        "- 模拟接口、假设、未实现能力和待验证风险。",
        "- 仍需人工决定的问题；不得自行改变 Baseline 或发布。", "",
        "## 现在开始", "",
        "先审计当前项目并给出 REQ 实现映射与阻塞项；如果没有关键阻塞，立即开始实现第一条端到端主流程并运行测试。", "",
    ])
    return "\n".join(lines)


def render_project(project_dir, include_prototype=False):
    root = Path(project_dir)
    project = read_json(root / "project.json")
    requirements = load_requirements(root)
    evidence = read_jsonl(root / "evidence" / "evidence.jsonl")
    model = read_json(root / "models" / "business-model.json")
    artifacts = root / "artifacts"
    atomic_write_text(artifacts / "proposal.md", render_markdown(project, requirements, "proposal"))
    prd = render_markdown(project, requirements, "prd")
    atomic_write_text(artifacts / "prd.md", prd)
    agent_prompt = build_agent_prompt(project, requirements, model, evidence)
    atomic_write_text(artifacts / "agent-prompt.md", agent_prompt)
    segments = read_jsonl(root / "sources" / "transcript.jsonl")
    sources = read_jsonl(root / "sources" / "sources.jsonl")
    reviews_path = root / "reviews" / "review.json"
    reviews = read_json(reviews_path) if reviews_path.is_file() else {"records": []}
    evidence_html = evidence_cards(evidence, segments, requirements)
    profile = project.get("requirement_profile", {})
    profile_html = "".join(f"<div class='wb-profile-item'><span>{e(key)}</span><p>{e(value)}</p></div>" for key, value in profile.items())
    if project.get("context_sources"):
        history_items = "".join(f"<li>{e(value)}</li>" for value in project["context_sources"])
        history_html = f"<ul class='wb-source-list'>{history_items}</ul>"
    else:
        history_html = "<div class='wb-empty-inline'><strong>未关联历史资料</strong><span>当前需求仅依据本次已提供材料，历史结论不会被默认继承。</span></div>"
    model_html = business_model_html(model)
    questions = [(item["requirement_id"], question) for item in requirements for question in item.get("pending_questions", [])]
    question_html = "".join(
        f"<li class='wb-question-item'><span class='wb-question-index'>{index}</span><div><strong>{e(req_id)}</strong><p>{e(question)}</p></div></li>"
        for index, (req_id, question) in enumerate(questions, 1)
    ) or "<li class='wb-empty-inline'><strong>暂无待确认问题</strong><span>当前需求可以进入团队评审。</span></li>"
    review_html = f"<ul class='wb-question-list'>{question_html}</ul>"
    prototype_exists = (artifacts / "prototype" / "index.html").is_file()
    prototype_link = "<a class='wb-btn wb-btn-primary' href='../prototype/index.html'>打开已确认原型</a>" if prototype_exists else "<span class='wb-soft-label'>原型待确认后生成</span>"
    prototype_nav = "<a href='../prototype/index.html'><svg viewBox='0 0 24 24'><path d='M4 4h16v16H4zM8 9l3 3-3 3M13 15h4'/></svg>原型预览</a>" if prototype_exists else "<a href='#versions'><svg viewBox='0 0 24 24'><path d='M4 4h16v16H4zM8 9l3 3-3 3M13 15h4'/></svg>原型待确认</a>"
    review_queue = ""
    if questions:
        first_req, first_question = questions[0]
        more = f"；另有 {len(questions) - 1} 项，请进入完整清单" if len(questions) > 1 else ""
        preview = f"{first_req}：{first_question}{more}"
        queue_title = f"{len(questions)} 个问题等待确认" + ("；已确认原型保持原基线" if prototype_exists else "，当前不会生成确认原型")
        review_queue = (
            "<section class='wb-review-queue' id='today-list' aria-label='今日要处理的评审事项'><svg viewBox='0 0 24 24'><path d='M12 4 2 20h20zM12 9v5M12 17v1'/></svg>"
            f"<div><strong>{e(queue_title)}</strong><p>{e(short_text(preview, 150))}</p></div><a href='#versions'>进入评审 →</a></section>"
        )
    else:
        review_queue = (
            "<section class='wb-review-queue' id='today-list' aria-label='今日要处理的评审事项'>"
            "<div><strong>今日没有待处理的评审事项</strong><p>当前待确认清单为空，可继续核对需求与交付物。</p></div><a href='#versions'>查看评审 →</a></section>"
        )
    counts = {status: sum(1 for item in requirements if item["status"] == status) for status in STATUS_LABELS}
    total_requirements = len(requirements)
    confirmed_count = counts["confirmed"]
    confirm_rate = round(confirmed_count * 100 / total_requirements) if total_requirements else 0
    status_chart = "".join(
        f"<div class='wb-status-row'><span>{e(STATUS_LABELS[status])}</span><div class='wb-bar-track'><span class='wb-bar-value wb-bar-{status}' style='width:{round(count * 100 / total_requirements) if total_requirements else 0}%'></span></div><strong>{count}</strong></div>"
        for status, count in counts.items()
    )
    timeline = "".join(
        f"<div class='wb-timeline-item'><strong>{e(record.get('action', 'record'))} · {e(record.get('actor', 'unknown'))}</strong><p>{e(record.get('note', record.get('decision', '')))}</p><time>{e(record.get('at', ''))}</time></div>"
        for record in reviews.get("records", [])
    ) or "<div class='wb-empty-inline'><strong>暂无评审记录</strong><span>人工确认、修改和锁定操作将在这里显示。</span></div>"
    export_data = {
        "project": project, "requirements": requirements, "evidence": evidence,
        "transcript_segments": segments, "sources": sources,
        "business_model": model, "reviews": reviews, "agent_prompt": agent_prompt,
    }
    safe_export_json = json.dumps(export_data, ensure_ascii=False).replace("<", "\\u003c")
    template = (SKILL_ROOT / "assets" / "workbench-template.html").read_text(encoding="utf-8")
    css = (SKILL_ROOT / "assets" / "ui.css").read_text(encoding="utf-8")
    project_status = PROJECT_STATUS_LABELS.get(project["status"], project["status"])
    workbench = replace_template(template, {
        "INLINE_CSS": css,
        "PROJECT_NAME": e(project["project_name"]), "GENERATION_MODE": e(project.get("generation_mode", "Agent 分析")),
        "CUSTOMER": e(project.get("customer", "TBD")), "VERSION": e(project["current_version"]),
        "BASELINE": e(project.get("current_baseline_id") or "尚未冻结"), "DESCRIPTION": e(project.get("description", "")),
        "PROJECT_STATUS": e(project_status), "UPDATED_AT": e(project.get("updated_at", "TBD")),
        "REQUIREMENT_COUNT": total_requirements, "EVIDENCE_COUNT": len(evidence),
        "QUESTION_COUNT": len(questions), "CONFIRMED_COUNT": confirmed_count,
        "DISPUTED_COUNT": counts["disputed"], "PARKED_COUNT": counts["parked"],
        "SEGMENT_COUNT": len(segments), "CONFIRM_RATE": confirm_rate,
        "STATUS_CHART": status_chart, "REVIEW_QUEUE": review_queue,
        "HISTORY_CONTENT": history_html, "EVIDENCE_ITEMS": evidence_html,
        "PROFILE_CONTENT": profile_html, "REQUIREMENT_CARDS": requirement_cards(requirements),
        "MODEL_CONTENT": model_html, "PRD_SUMMARY": e(short_text(project.get("description", ""), 180)),
        "REVIEW_CONTENT": review_html, "REVIEW_TIMELINE": timeline,
        "PROTOTYPE_NAV": prototype_nav, "PROTOTYPE_ACTION": prototype_link,
        "EXPORT_JSON": safe_export_json, "AGENT_PROMPT": e(agent_prompt),
    })
    (artifacts / "workbench").mkdir(parents=True, exist_ok=True)
    atomic_write_text(artifacts / "workbench" / "index.html", workbench)
    atomic_write_text(artifacts / "workbench" / "ui.css", css)
    if include_prototype:
        if not project.get("current_baseline_id"):
            raise ValueError("Prototype requires an approved current baseline")
        baseline_path = root / "baselines" / f"{project['current_version']}.json"
        baseline = read_json(baseline_path)
        confirmed = [item for item in baseline["confirmed_requirements"] if item["status"] == "confirmed"]
        if not confirmed:
            raise ValueError("Prototype requires at least one confirmed requirement")
        prototype_template = (SKILL_ROOT / "assets" / "prototype-template.html").read_text(encoding="utf-8")
        safe_json = json.dumps(confirmed, ensure_ascii=False).replace("<", "\\u003c")
        flow_json = json.dumps(project.get("prototype_flow"), ensure_ascii=False).replace("<", "\\u003c")
        prototype = replace_template(prototype_template, {
            "PROJECT_NAME": e(project["project_name"]), "VERSION": e(project["current_version"]),
            "REQ_IDS": e(", ".join(item["requirement_id"] for item in confirmed)),
            "REQUIREMENT_DETAILS": requirement_cards(confirmed), "REQUIREMENTS_JSON": safe_json,
            "FLOW_JSON": flow_json,
        })
        atomic_write_text(artifacts / "prototype" / "index.html", prototype)
        atomic_write_text(artifacts / "prototype" / "ui.css", css)
    if include_prototype:
        snapshot = artifacts / "versions" / project["current_version"]
        for relative in ["proposal.md", "prd.md", "agent-prompt.md", "workbench/index.html", "workbench/ui.css", "prototype/index.html", "prototype/ui.css"]:
            source = artifacts / relative
            if source.is_file():
                atomic_write_text(snapshot / relative, source.read_text(encoding="utf-8"))
    return [str(path) for path in sorted(artifacts.rglob("*")) if path.is_file()]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, type=Path)
    parser.add_argument("--prototype", action="store_true", help="Also render from the frozen current baseline")
    args = parser.parse_args()
    try:
        files = render_project(args.project, args.prototype)
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        parser.exit(1, f"Render failed: {error}\n")
    print(json.dumps({"generated": files}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
