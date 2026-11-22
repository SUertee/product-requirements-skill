#!/usr/bin/env python3
"""Build generic prototype pages from confirmed requirements and project flows."""
import json
from pathlib import Path

from project_lib import SKILL_ROOT


def _requirements_page():
    return {
        "page_id": "requirements",
        "name": "需求与验收",
        "type": "requirements",
        "task": "已确认需求与验收",
        "requirement_ids": [],
        "fields": [],
        "actions": [],
        "hide_records": True,
    }


def _legacy_pages(project, confirmed):
    flow = project.get("prototype_flow")
    if not flow:
        return []
    requirement_ids = flow.get("requirement_ids", [item["requirement_id"] for item in confirmed])
    fields = [{"id": "name", "label": "客户名称", "type": "search", "placeholder": "输入客户名称"}]
    if flow.get("owner_filter"):
        fields.append({"id": "owner", "label": "负责人", "type": "select", "options": sorted({item.get("owner", "") for item in flow.get("items", [])}), "match_rule": "exact", "blank_label": "全部负责人"})
    archive = flow.get("archive")
    row_actions = [{"type": "navigate", "label": "查看跟进记录", "target_page_id": "customer-detail"}]
    detail_actions = [{"type": "navigate", "label": "返回客户列表", "target_page_id": "customer-list"}]
    if archive:
        row_actions.append({"type": "archive", "label": archive.get("label", "归档") if isinstance(archive, dict) else "归档"})
        detail_actions.append({"type": "archive", "label": "归档当前客户"})
    return [
        {
            "page_id": "customer-list",
            "name": flow.get("title", "客户查询"),
            "task": flow.get("title", "客户查询") + "（示例数据）",
            "description": "查询与归档仅操作页面内示例数据；权限和真实接口仍需服务端实现。",
            "requirement_ids": requirement_ids,
            "query": {"match_rule": flow.get("match_rule", "contains"), "fields": fields},
            "fields": fields,
            "actions": [
                {"id": "query", "type": "query", "label": "查询客户"},
                {"id": "clear", "type": "clear", "label": "清除条件"},
                {"id": "empty", "type": "empty", "label": "查看空状态"},
                {"id": "error", "type": "error", "label": "模拟接口失败"},
                {"id": "reset", "type": "reset", "label": "返回入口"},
            ],
            "records": flow.get("items", []),
            "records_title": "客户列表",
            "columns": [{"id": "name", "label": "客户"}, {"id": "owner", "label": "负责人"}],
            "row_actions": row_actions,
            "empty_message": "暂无匹配客户。请清除条件后重试。",
            "field_labels": {"owner": "负责人"},
        },
        {
            "page_id": "customer-detail",
            "name": "客户跟进时间线",
            "type": "detail",
            "requirement_ids": requirement_ids,
            "records_from": "customer-list",
            "detail": {"title_field": "name", "meta_fields": ["owner"], "timeline_field": "follow_ups", "time_field": "time", "text_field": "text", "sort": "desc"},
            "field_labels": {"owner": "负责人"},
            "actions": detail_actions,
            "hide_records": True,
        },
    ]


def _fallback_pages(confirmed):
    pages = []
    for item in confirmed:
        pages.append({
            "page_id": "task-" + item["requirement_id"].lower(),
            "name": item["title"],
            "task": item["expected_result"],
            "description": "通用模拟任务页；具体业务动作需在 prototype_pages 中定义。",
            "requirement_ids": [item["requirement_id"]],
            "fields": [{"id": "task", "label": "任务说明", "type": "textarea", "required": True}],
            "actions": [
                {"id": "complete", "type": "submit", "label": "模拟完成此任务", "success_message": item["requirement_id"] + " 模拟操作成功；未调用真实接口"},
                {"id": "empty", "type": "empty", "label": "查看空状态"},
                {"id": "error", "type": "error", "label": "模拟接口失败"},
                {"id": "reset", "type": "reset", "label": "返回入口"},
            ],
            "records": [],
            "columns": [{"id": "task", "label": "任务说明"}, {"id": "record_id", "label": "记录 ID"}],
        })
    return pages


def build_prototype_pages(project, confirmed):
    """Prefer explicit generic pages; adapt legacy flow; finally use generic tasks."""
    explicit = project.get("prototype_pages")
    if explicit:
        pages = json.loads(json.dumps(explicit, ensure_ascii=False))
    else:
        pages = _legacy_pages(project, confirmed) or _fallback_pages(confirmed)
    identities = set()
    for page in pages:
        page_id = page.get("page_id")
        if not isinstance(page_id, str) or not page_id or page_id in identities:
            raise ValueError("Prototype page_id values must be unique nonempty strings")
        identities.add(page_id)
        page.setdefault("name", page_id)
        page.setdefault("requirement_ids", [])
        page.setdefault("fields", [])
        page.setdefault("actions", [])
        page.setdefault("records", [])
        for action in page.get("row_actions", []) + page.get("actions", []):
            if action.get("type") == "navigate" and not action.get("target_page_id"):
                raise ValueError(f"Prototype navigate action requires target_page_id: {page_id}")
        for action in page.get("row_actions", []) + page.get("actions", []):
            target = action.get("target_page_id")
            if action.get("type") == "navigate" and target and target != "requirements" and not any(candidate.get("page_id") == target for candidate in pages):
                raise ValueError(f"Prototype action references unknown page: {target}")
    if "requirements" not in identities:
        pages.append(_requirements_page())
    if not pages:
        raise ValueError("Prototype requires at least one page")
    return pages


def build_prototype_data(project, confirmed):
    return {
        "name": project["project_name"],
        "project_id": project["project_id"],
        "artifact_version": project["current_version"],
        "baseline_id": project.get("current_baseline_id"),
        "generation_mode": project.get("generation_mode", "Agent + deterministic scripts"),
        "requirements": confirmed,
        "pages": build_prototype_pages(project, confirmed),
    }


def render_prototype(project, confirmed):
    data = build_prototype_data(project, confirmed)
    template = (SKILL_ROOT / "assets" / "prototype-template.html").read_text(encoding="utf-8")
    css = (SKILL_ROOT / "assets" / "ui.css").read_text(encoding="utf-8")
    safe_json = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    rendered = template.replace("__PROTOTYPE_STYLE__", css).replace("__PROTOTYPE_DATA__", safe_json)
    if "__PROTOTYPE_" in rendered:
        raise ValueError("Unresolved prototype template token")
    return rendered
