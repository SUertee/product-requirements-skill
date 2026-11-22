#!/usr/bin/env python3
"""Render proposal, PRD and static HTML deliverables from shared Project Data.

Only ``render_project`` writes artifacts. It always runs ``preflight`` first and
writes through ``write_if_changed``; keeping a single write path prevents the
manual-edit protection from being bypassed by a legacy renderer.
"""
import argparse
import json
from pathlib import Path
import re

from delivery_render import render_technical_design, render_deck_brief, render_schedule
from artifact_state import (
    preflight, record_approved_overwrites, snapshot_without_overwrite,
    update_state, write_if_changed,
)
from prototype import render_prototype
from project_lib import (
    SKILL_ROOT, load_requirements, read_json, read_jsonl, read_optional_json,
)


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
    """Render a decision-first document without padding unknown sections."""
    title = "项目方案" if artifact == "proposal" else "产品需求文档"
    profile = project.get("requirement_profile", {})
    active = [item for item in requirements if item.get("status") not in {"parked", "cancelled"}]
    parked = [item for item in requirements if item.get("status") in {"parked", "cancelled"}]
    lines = [
        f"# {project['project_name']} {title}", "",
        f"> {project['current_version']} · {project['status']} · Baseline：{project.get('current_baseline_id') or '尚未冻结'}", "",
        "## 概述", "", project.get("description", "项目定义待确认"), "",
    ]
    background = "；".join(value for key, value in profile.items() if key in {"业务场景", "核心痛点"} and value)
    if background:
        lines.extend(["## 背景与问题", "", background, ""])
    objective = profile.get("目标结果")
    if objective:
        lines.extend(["## 目标与结果指标", "", objective, ""])
    roles = sorted({role.strip() for item in active for role in re.split(r"[、，,]", item["customer_role"]) if role.strip()})
    if roles:
        lines.extend(["## 用户与价值", "", *[f"- {role}：减少当前流程中的查找、核对或操作成本，具体结果以关联 REQ 验收为准。" for role in roles], ""])
    scope = profile.get("需求范围")
    lines.extend(["## 范围与非目标", ""])
    if scope:
        lines.extend([scope, ""])
    lines.extend([f"- 本期：{item['requirement_id']} {item['title']}（{item.get('priority', '优先级待确认')}）" for item in active] or ["- 本期范围待确认"])
    lines.extend([f"- 暂缓／非目标：{item['requirement_id']} {item['title']}" for item in parked])
    if artifact == "proposal":
        lines.extend(["", "## 解决方案与实施路径", ""])
        for item in active:
            lines.append(f"- **{item['requirement_id']} {item['title']}**：{item['expected_result']}")
        lines.extend(["", "需求确认后，原型与技术设计基于同一 Baseline 并行；排期与汇报只读取确认后的工作包和版本。", ""])
    else:
        lines.extend(["", "## 核心需求与验收", ""])
        for item in active:
            lines.extend(requirement_text(item))
        constraints = sorted({value for item in active for value in item.get("constraints", []) + item.get("dependencies", [])})
        if constraints:
            lines.extend(["## 质量约束与集成", "", *[f"- {value}" for value in constraints], ""])
    lines.extend(["## 风险、假设与待确认", ""])
    questions = [f"{item['requirement_id']}：{question}" for item in requirements for question in item.get("pending_questions", [])]
    lines.extend([f"- {question}" for question in questions] or ["- 当前没有登记的阻塞问题；仍按各 REQ 证据等级区分事实、推断与建议。"])
    lines.extend(["", "## 验收与追溯", "", "验收与所属 REQ 保持稳定关联；Evidence ID 可回查 Segment 原话和时间。变更经 ChangeSet 批准后只更新受影响成果。", ""])
    return "\n".join(lines)

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

def generated_artifacts(root):
    """Return real, current artifacts for the data-driven branch workbench."""
    artifacts = root / "artifacts"
    if not artifacts.is_dir():
        return []
    return [
        {"path": path.relative_to(root).as_posix(), "bytes": path.stat().st_size}
        for path in sorted(artifacts.rglob("*"))
        if path.is_file() and "versions" not in path.relative_to(artifacts).parts
    ]

def render_branch_workbench(root, project, requirements, evidence, model, technical, plan, brief, agent_prompt):
    """Render the feat/workflow-execution HTML shell with current Project Data."""
    template = (SKILL_ROOT / "assets" / "workbench-template.html").read_text(encoding="utf-8")
    css = (SKILL_ROOT / "assets" / "workbench.css").read_text(encoding="utf-8")
    script = (SKILL_ROOT / "assets" / "workbench.js").read_text(encoding="utf-8")
    export_data = {
        "project": project,
        "requirements": requirements,
        "evidence": evidence,
        "transcript_segments": read_jsonl(root / "sources" / "transcript.jsonl"),
        "sources": read_jsonl(root / "sources" / "sources.jsonl"),
        "business_model": model,
        "reviews": read_json(root / "reviews" / "review.json") if (root / "reviews" / "review.json").is_file() else {"records": []},
        "agent_prompt": agent_prompt,
        "technical_design": technical,
        "delivery_plan": plan,
        "deck_brief": brief,
        "artifacts": generated_artifacts(root),
        "changesets": [path.relative_to(root).as_posix() for path in sorted((root / "changesets").glob("changeset-*.json"))],
        "generated_at": project.get("updated_at"),
        "template_source": "feat/workflow-execution@0488753; adapted to current Project Data",
    }
    safe_json = json.dumps(export_data, ensure_ascii=False).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    rendered = template.replace("__WORKBENCH_STYLE__", css)
    rendered = rendered.replace("__WORKBENCH_DATA__", safe_json)
    rendered = rendered.replace("__WORKBENCH_SCRIPT__", script)
    if "__WORKBENCH_" in rendered:
        raise ValueError("Unresolved branch workbench template token")
    return rendered, css

ARTIFACT_FILES = {
    "proposal": ("artifacts/proposal.md",),
    "prd": ("artifacts/prd.md",),
    "agent_prompt": ("artifacts/agent-prompt.md",),
    "workbench": ("artifacts/workbench/index.html", "artifacts/workbench/ui.css"),
    "technical_design": ("artifacts/technical-design.md",),
    "schedule": ("artifacts/schedule/index.html", "artifacts/schedule/ui.css"),
    "deck_brief": ("artifacts/deck-brief.md",),
    "prototype": ("artifacts/prototype/index.html", "artifacts/prototype/ui.css"),
}

def render_project(project_dir, include_prototype=False, only=None, approved_overwrites=None, overwrite_snapshots=False):
    """Render selected artifacts with preflight human-edit protection."""
    root = Path(project_dir)
    project = read_json(root / "project.json")
    requirements = load_requirements(root)
    evidence = read_jsonl(root / "evidence" / "evidence.jsonl")
    model = read_json(root / "models" / "business-model.json")
    technical = read_optional_json(root / "models" / "technical-design.json")
    plan = read_optional_json(root / "models" / "delivery-plan.json")
    brief = read_optional_json(root / "models" / "deck-brief.json")
    approved = set(approved_overwrites or [])
    if isinstance(only, str):
        only = only.split(",")
    selected = set(only) if only is not None else set(ARTIFACT_FILES) - {"prototype"}
    if include_prototype:
        selected.add("prototype")
    unknown = selected - set(ARTIFACT_FILES)
    if unknown or not selected:
        raise ValueError("Invalid or empty artifact selection: " + ", ".join(sorted(unknown or selected)))
    targets = sorted({relative for key in selected for relative in ARTIFACT_FILES[key]})
    approved_conflicts = preflight(root, targets, approved)
    generated_hashes = {}

    def write(relative, content):
        _, digest = write_if_changed(root / relative, content)
        generated_hashes[relative] = digest

    def delete(relative):
        path = root / relative
        if path.is_file():
            path.unlink()
        generated_hashes.pop(relative, None)

    if "proposal" in selected:
        write("artifacts/proposal.md", render_markdown(project, requirements, "proposal"))
    if "prd" in selected:
        write("artifacts/prd.md", render_markdown(project, requirements, "prd"))
    agent_prompt = build_agent_prompt(project, requirements, model, evidence)
    if "agent_prompt" in selected:
        write("artifacts/agent-prompt.md", agent_prompt)
    css = (SKILL_ROOT / "assets" / "ui.css").read_text(encoding="utf-8")
    if "technical_design" in selected:
        if technical:
            write("artifacts/technical-design.md", render_technical_design(technical, project))
        else:
            delete("artifacts/technical-design.md")
    if "schedule" in selected:
        if plan:
            write("artifacts/schedule/index.html", render_schedule(project, plan, css))
            write("artifacts/schedule/ui.css", css)
        else:
            delete("artifacts/schedule/index.html")
            delete("artifacts/schedule/ui.css")
    if "deck_brief" in selected:
        if brief:
            write("artifacts/deck-brief.md", render_deck_brief(brief, project))
        else:
            delete("artifacts/deck-brief.md")
    if "prototype" in selected:
        if not project.get("current_baseline_id"):
            raise ValueError("Prototype requires an approved current baseline")
        baseline = read_json(root / "baselines" / f"{project['current_version']}.json")
        confirmed = [item for item in baseline["confirmed_requirements"] if item["status"] == "confirmed"]
        if not confirmed:
            raise ValueError("Prototype requires at least one confirmed requirement")
        prototype = render_prototype(project, confirmed)
        write("artifacts/prototype/index.html", prototype)
        write("artifacts/prototype/ui.css", css)
    if "workbench" in selected:
        workbench, workbench_css = render_branch_workbench(
            root, project, requirements, evidence, model, technical, plan, brief, agent_prompt,
        )
        write("artifacts/workbench/index.html", workbench)
        write("artifacts/workbench/ui.css", workbench_css)
    if include_prototype:
        snapshot = root / "artifacts" / "versions" / project["current_version"]
        for key in selected:
            for relative in ARTIFACT_FILES[key]:
                source = root / relative
                if source.is_file():
                    snapshot_path = snapshot / Path(relative).relative_to("artifacts")
                    if overwrite_snapshots:
                        write_if_changed(snapshot_path, source.read_text(encoding="utf-8"))
                    else:
                        snapshot_without_overwrite(snapshot_path, source.read_text(encoding="utf-8"))
    record_approved_overwrites(root, approved_conflicts)
    update_state(root, project, generated_hashes)
    return [str(path) for path in sorted((root / "artifacts").rglob("*")) if path.is_file()]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, type=Path)
    parser.add_argument("--prototype", action="store_true", help="Also render from the frozen current baseline")
    parser.add_argument("--only", help="Comma-separated artifact keys: " + ",".join(ARTIFACT_FILES))
    parser.add_argument("--approve-artifact", action="append", default=[], metavar="RELATIVE_PATH", help="Explicitly approve overwriting a manually edited artifact; repeatable")
    args = parser.parse_args()
    try:
        files = render_project(args.project, args.prototype, only=args.only, approved_overwrites=args.approve_artifact)
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        parser.exit(1, f"Render failed: {error}\n")
    print(json.dumps({"generated": files}, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
