#!/usr/bin/env python3
"""Deterministic technical-design, schedule and deck-brief rendering."""
from datetime import date, timedelta
import html
from pathlib import Path

from project_lib import SKILL_ROOT

STATUS_LABELS = {
    "draft": "草稿", "reviewed": "已复核", "approved": "已批准",
    "proposed": "建议", "confirmed": "已确认", "in_progress": "进行中",
    "completed": "已完成", "blocked": "阻塞", "generated": "已生成",
    "verified": "已验证", "failed": "失败", "not_exported": "未导出",
    "exported": "已导出", "proposed_decision": "候选决策",
}

def e(value):
    return html.escape(str(value), quote=True)

def replace_template(template, values):
    for key, value in values.items():
        template = template.replace("{{" + key + "}}", str(value))
    if "{{" in template:
        raise ValueError("Unresolved schedule template token")
    return template

def req_text(item):
    return "、".join(item.get("requirement_ids", [])) or "项目级"

def render_technical_design(technical, project):
    lines = [
        f"# {project['project_name']} 技术设计", "",
        f"> 版本：{technical['version']}；评审状态：{technical['status']}。候选设计不等同于已存在实现或客户确认事实。", "",
        "## 设计概述", "", technical["summary"], "", "## 技术决策", "",
    ]
    if technical.get("decisions"):
        for item in technical["decisions"]:
            lines.extend([
                f"### {item['decision_id']} · {item['title']}", "",
                f"- 状态：{item['status']}",
                f"- 关联 REQ：{req_text(item)}",
                f"- 决策：{item['decision']}",
                f"- 理由：{item.get('rationale') or '待补充'}", "",
            ])
    else:
        lines.extend(["暂无技术决策。", ""])
    lines.extend(["## 图示与验证", ""])
    if technical.get("diagrams"):
        for item in technical["diagrams"]:
            lines.append(f"### {item['diagram_id']} · {item['title']}")
            lines.extend(["", f"- 类型：{item['diagram_type']}；状态：{item['status']}", f"- 关联 REQ：{req_text(item)}"])
            for field, label in [("spec_path", "Mermaid 输入"), ("drawio_path", "draw.io 文件"), ("png_path", "PNG 预览")]:
                if item.get(field):
                    lines.append(f"- {label}：`{item[field]}`")
            if item.get("generator"):
                lines.append(f"- 生成器：{item['generator']}")
            for result in item.get("validation_results", []):
                lines.append(f"- 检查：{result}")
            lines.append("")
    else:
        lines.extend(["尚未登记图示。候选 `.mmd` 不代表 draw.io 或 PNG 已生成。", ""])
    lines.extend(["## 待确认", ""])
    lines.extend([f"- {question}" for question in technical.get("pending_questions", [])] or ["- 无"])
    return "\n".join(lines) + "\n"

def render_deck_brief(brief, project):
    lines = [
        f"# {project['project_name']} · PPT 内容简报", "",
        f"> 版本：{brief['version']}；Baseline：{brief.get('baseline_id') or '未冻结'}；评审：{brief['review_status']}；导出：{brief['export_status']}。", "",
        "**本文件是 huashu-design 的输入简报，不是 PPT 成品。只有 output_paths 中的真实文件通过检查后才可称为已导出。**", "",
        f"- 汇报对象：{brief['audience']}",
        f"- 汇报目标：{brief['objective']}", "",
        "## 幻灯片大纲", "",
    ]
    for index, slide in enumerate(brief.get("slides", []), 1):
        lines.extend([
            f"### {index}. {slide['title']} · {slide['slide_id']}", "",
            f"目的：{slide['purpose']}", "",
            *[f"- {point}" for point in slide["content"]],
            f"- 关联 REQ：{req_text(slide)}",
        ])
        if slide.get("visual_hint"):
            lines.append(f"- 视觉建议：{slide['visual_hint']}")
        if slide.get("source_paths"):
            lines.append(f"- 内容来源：{'、'.join(slide['source_paths'])}")
        lines.append("")
    lines.extend(["## 导出记录", ""])
    if brief.get("output_paths"):
        lines.extend([f"- `{path}`" for path in brief["output_paths"]])
    else:
        lines.append("- 尚未执行真实 PPTX／HTML deck 导出。")
    return "\n".join(lines) + "\n"

def _schedule_bounds(items):
    dated = [item for item in items if item.get("start_date") and item.get("end_date")]
    if not dated:
        return None, None
    return min(date.fromisoformat(item["start_date"]) for item in dated), max(date.fromisoformat(item["end_date"]) for item in dated)

def _bar_style(item, minimum, maximum):
    total = (maximum - minimum).days + 1
    start = date.fromisoformat(item["start_date"])
    end = date.fromisoformat(item["end_date"])
    left = (start - minimum).days * 100 / total
    width = ((end - start).days + 1) * 100 / total
    return f"left:{left:.4f}%;width:{width:.4f}%"

def _ticks(minimum, maximum):
    if not minimum:
        return ""
    total = (maximum - minimum).days
    values = []
    for index in range(6):
        current = minimum + timedelta(days=round(total * index / 5))
        values.append(f"<span>{e(current.strftime('%m/%d'))}</span>")
    return "".join(values)

def _work_row(item, minimum=None, maximum=None):
    priority = item.get("priority", "P2")
    owner = item.get("owner") or "负责人待确认"
    dependencies = "、".join(item.get("dependencies", [])) or "无前置依赖"
    info = (
        f"<div class='schedule-work'><div><span class='schedule-priority schedule-{e(priority.lower())}'>{e(priority)}</span>"
        f"<strong>{e(item['title'])}</strong></div><small>{e(item['work_id'])} · {e(req_text(item))} · {e(owner)}</small>"
        f"<small>依赖：{e(dependencies)} · {e(STATUS_LABELS.get(item['status'], item['status']))}</small></div>"
    )
    if minimum is None:
        return f"<article class='schedule-unscheduled-item'>{info}</article>"
    label = f"{item['start_date']} — {item['end_date']}"
    bar = (
        f"<div class='schedule-track'><span class='schedule-bar schedule-bar-{e(item['status'])}' style='{_bar_style(item, minimum, maximum)}' title='{e(label)}'>"
        f"<b>{e(label)}</b></span></div>"
    )
    return f"<div class='schedule-row'>{info}{bar}</div>"

def render_schedule(project, plan, css):
    items = plan.get("items", [])
    scheduled = [item for item in items if item.get("start_date") and item.get("end_date")]
    unscheduled = [item for item in items if not item.get("start_date")]
    minimum, maximum = _schedule_bounds(scheduled)
    if scheduled:
        rows = "".join(_work_row(item, minimum, maximum) for item in scheduled)
        gantt = (
            "<div class='schedule-scroll'><div class='schedule-gantt'>"
            f"<div class='schedule-axis'><strong>工作包 / REQ / 负责人</strong><div class='schedule-ticks'>{_ticks(minimum, maximum)}</div></div>"
            f"{rows}</div></div>"
        )
        date_range = f"{minimum.isoformat()} — {maximum.isoformat()}"
    else:
        gantt = "<div class='wb-empty'><strong>暂无可绘制的时间轴</strong><span>所有工作包均在等待明确日期。</span></div>"
        date_range = "待确认排期范围"
    unscheduled_html = "".join(_work_row(item) for item in unscheduled) or "<div class='wb-empty-inline'><strong>没有待排期项</strong><span>所有工作包均有明确起止日期。</span></div>"
    assumptions = "".join(f"<li>{e(value)}</li>" for value in plan.get("assumptions", [])) or "<li>未提供额外排期假设。</li>"
    template = (SKILL_ROOT / "assets" / "schedule-template.html").read_text(encoding="utf-8")
    return replace_template(template, {
        "INLINE_CSS": css, "PROJECT_NAME": e(project["project_name"]), "VERSION": e(plan["version"]),
        "PLAN_STATUS": e(STATUS_LABELS.get(plan["status"], plan["status"])),
        "TOTAL_COUNT": len(items), "SCHEDULED_COUNT": len(scheduled), "UNSCHEDULED_COUNT": len(unscheduled),
        "DATE_RANGE": e(date_range), "GANTT_CONTENT": gantt, "UNSCHEDULED_CONTENT": unscheduled_html,
        "ASSUMPTIONS_CONTENT": f"<ul class='schedule-assumptions'>{assumptions}</ul>",
        "GENERATION_MODE": e(project.get("generation_mode", "Agent + deterministic scripts")),
    })

