#!/usr/bin/env python3
"""Execute a reproducible, explicitly simulated end-to-end Skill fixture.

This is not a general-purpose LLM and not a real customer approval. In real use,
the Agent performs semantic extraction and waits for the user's explicit gates.
"""
import argparse
import copy
import json
from pathlib import Path
import subprocess
import sys

from normalize_transcript import normalize
from project_lib import (
    SKILL_ROOT, project_errors, read_json, requirement_container, stable_id,
    atomic_write_text, utc_now, write_json, write_jsonl,
)
from render_artifacts import render_project

FIXTURE = SKILL_ROOT / "tests" / "fixtures" / "demo_extraction.json"
INPUT = SKILL_ROOT / "examples" / "input"


def material_and_segments(path, project_id, source_type, meeting_id):
    material, segments = normalize(path, project_id, meeting_id)
    material["source_type"] = source_type
    for segment in segments:
        segment["source_type"] = source_type
    return material, segments


def make_evidence(project_id, specifications, sources, segments, created_at):
    by_source = {item["source_id"]: item for item in sources}
    evidence = {}
    for specification in specifications:
        matches = [segment for segment in segments if specification["quote"] in segment["original_text"]]
        if len(matches) != 1:
            raise ValueError(f"Expected exactly one source segment for quote: {specification['quote']}")
        segment = matches[0]
        source = by_source[segment["source_id"]]
        evidence_id = stable_id("EVD-", project_id, segment["segment_id"], specification["quote"])
        evidence[specification["key"]] = {
            "schema_version": "1.0", "evidence_id": evidence_id, "project_id": project_id,
            "source_id": segment["source_id"], "segment_id": segment["segment_id"],
            "start_time": segment["start_time"], "end_time": segment["end_time"],
            "original_quote": specification["quote"], "evidence_level": specification["level"],
            "source_type": source["source_type"], "is_inferred": specification["level"] in {"E2", "E3"},
            "created_at": created_at,
        }
    return evidence


def build_requirements(fixture, project_id, evidence, created_at):
    requirements = []
    for index, item in enumerate(fixture["requirements"], 1):
        requirements.append({
            "schema_version": "1.0", "requirement_id": f"REQ-{index:03d}", "project_id": project_id,
            "title": item["title"], "description": item["description"],
            "customer_role": item["customer_role"], "business_scenario": item["business_scenario"],
            "pain_point": item["pain_point"], "trigger": item["trigger"],
            "expected_result": item["expected_result"], "scope": item["scope"],
            "constraints": item["constraints"], "dependencies": item["dependencies"],
            "acceptance_criteria": item["acceptance_criteria"], "priority": item["priority"],
            "evidence_ids": [evidence[key]["evidence_id"] for key in item["evidence_keys"]],
            "evidence_level": item["evidence_level"], "status": item["initial_status"],
            "locked_by_human": item["locked_by_human"], "locked_fields": item["locked_fields"],
            "pending_questions": item["pending_questions"], "version": "v1.0",
            "created_at": created_at, "updated_at": created_at,
        })
    return requirements


def assert_valid(root):
    errors = project_errors(root)
    if errors:
        raise ValueError("Project validation failed: " + "; ".join(errors))


def run_demo(output, force=False):
    fixture = read_json(FIXTURE)
    project_id = fixture["project"]["project_id"]
    created_at = utc_now()
    root = output.resolve()
    if root == SKILL_ROOT or SKILL_ROOT / "scripts" == root:
        raise ValueError("Demo output must be a project data directory")
    if (root / "project.json").exists() and not force:
        raise ValueError("Demo project already exists; choose a new output or explicitly use --force")
    root.mkdir(parents=True, exist_ok=True)
    sources, segments = [], []
    for file_name, source_type, meeting_id in [
        ("demo_meeting.srt", "transcript", "MEET-DEMO-001"),
        ("history.md", "history", "MEET-HISTORY-001"),
        ("customer_feedback.md", "feedback", "MEET-FEEDBACK-001"),
    ]:
        material, rows = material_and_segments(INPUT / file_name, project_id, source_type, meeting_id)
        sources.append(material)
        segments.extend(rows)
    evidence_by_key = make_evidence(project_id, fixture["evidence"], sources, segments, created_at)
    # The first run must not expose future feedback to the initial requirement model.
    initial_evidence = {key: value for key, value in evidence_by_key.items() if key != "feedback_search"}
    requirements = build_requirements(fixture, project_id, initial_evidence, created_at)
    project = {
        "schema_version": "1.0", **fixture["project"], "current_baseline_id": None,
        "current_version": "v1.0", "status": "draft",
        "context_sources": [str((INPUT / "history.md").resolve())],
        "requirement_profile": {
            "客户与角色": "星云贸易销售主管、管理员、普通销售",
            "业务场景": "客户查询、权限范围内的客户详情与跟进记录查看",
            "核心痛点": "客户和跟进记录分散，容易重复沟通",
            "目标结果": "减少查找和核对时间；量化指标 TBD",
            "需求范围": "权限、名称查询、跟进时间线；智能能力待澄清",
            "约束条件": "沿用现有 CRM，桌面浏览器，不接短信；预算和日期 TBD",
            "集成与依赖": "现有 CRM 用户、客户负责人和跟进记录",
            "证据与待确认": "历史全员可见与新权限规则冲突；匹配方式、排序和智能化待确认",
        },
        "design_context": {"product_type": "内部业务系统", "target_devices": ["desktop"], "design_system_version": "built-in-ui-v0.1"},
        "prototype_flow": {
            "title": "查询客户并查看跟进", "requirement_ids": ["REQ-001", "REQ-002", "REQ-003"], "owner_filter": False,
            "items": [
                {"id": "CUS-001", "name": "星澜科技", "owner": "销售 A", "follow_ups": [{"time": "2026-11-01 10:00", "text": "示例：确认采购需求"}, {"time": "2026-11-08 14:30", "text": "示例：发送产品资料"}]},
                {"id": "CUS-002", "name": "云川制造", "owner": "销售 B", "follow_ups": [{"time": "2026-11-03 09:20", "text": "示例：约定下次演示"}]},
                {"id": "CUS-003", "name": "星澜零售", "owner": "销售 A", "follow_ups": [{"time": "2026-11-05 16:00", "text": "示例：核对联系人"}]}
            ]
        },
        "generation_mode": "固定样例模拟生成（非真实客户分析）",
        "created_at": created_at, "updated_at": created_at,
    }
    write_json(root / "project.json", project)
    write_jsonl(root / "sources" / "sources.jsonl", sources)
    write_jsonl(root / "sources" / "transcript.jsonl", segments)
    write_jsonl(root / "evidence" / "evidence.jsonl", list(initial_evidence.values()))
    write_json(root / "requirements" / "requirements.json", requirement_container(project_id, requirements))
    write_json(root / "models" / "business-model.json", {
        "schema_version": "1.0",
        "roles": [{"name": "管理员", "requirement_ids": ["REQ-001"]}, {"name": "普通销售", "requirement_ids": ["REQ-001", "REQ-002", "REQ-003"]}],
        "workflows": [{"name": "查询客户并查看跟进", "requirement_ids": ["REQ-001", "REQ-002", "REQ-003"], "steps": ["客户列表", "权限过滤", "名称查询", "客户详情", "跟进时间线"]}],
        "entities": [{"name": "客户", "fields": ["客户名称", "负责人"], "requirement_ids": ["REQ-001", "REQ-002"]}, {"name": "跟进记录", "fields": ["客户", "时间", "内容"], "requirement_ids": ["REQ-003"]}],
        "rules": [{"rule": "普通销售仅查看本人负责客户", "requirement_ids": ["REQ-001"]}],
        "states": [], "integrations": [{"name": "现有 CRM", "status": "候选集成，未接通"}],
    })
    reviews = {"schema_version": "1.0", "records": [{"action": "draft_created", "actor": "demo-fixture", "at": created_at, "simulated": True}]}
    write_json(root / "reviews" / "review.json", reviews)
    write_jsonl(root / "sources" / "transcript.jsonl", [row for row in segments if row["source_type"] != "feedback"])
    write_jsonl(root / "sources" / "sources.jsonl", [row for row in sources if row["source_type"] != "feedback"])
    (root / "reviews").mkdir(exist_ok=True)
    atomic_write_text(root / "reviews" / "review.md", "# 固定样例评审\n\n草稿已生成。以下确认均为演示夹具动作，不是真实客户审批。\n")
    render_project(root)
    assert_valid(root)

    # Explicitly simulated demo gate: resolve the historical conflict and freeze v1.0.
    confirmed = []
    for item in requirements:
        if item["evidence_level"] == "E1":
            item["status"] = "confirmed"
            if item["requirement_id"] == "REQ-001":
                item["pending_questions"] = []
            confirmed.append(copy.deepcopy(item))
    baseline_id = "BASE-v1.0"
    baseline = {
        "schema_version": "1.0", "baseline_id": baseline_id, "project_id": project_id,
        "version": "v1.0", "status": "frozen", "confirmed_requirements": confirmed,
        "confirmed_at": utc_now(), "confirmed_by": "demo-reviewer（固定样例确认）", "simulated_confirmation": True,
    }
    write_json(root / "baselines" / "v1.0.json", baseline)
    project.update({"current_baseline_id": baseline_id, "status": "baselined", "updated_at": utc_now()})
    write_json(root / "project.json", project)
    write_json(root / "requirements" / "requirements.json", requirement_container(project_id, requirements))
    reviews["records"].extend([
        {"action": "resolve_conflict", "requirement_id": "REQ-001", "decision": "固定样例选择新会议权限规则，历史草案仅保留追溯", "actor": "demo-reviewer", "simulated": True, "at": utc_now()},
        {"action": "baseline_confirmed", "baseline_id": baseline_id, "actor": "demo-reviewer", "simulated": True, "at": utc_now()},
    ])
    write_json(root / "reviews" / "review.json", reviews)
    render_project(root, include_prototype=True)
    assert_valid(root)

    # Add real feedback Source/Segment/Evidence, then compare only baseline-confirmed REQ.
    feedback_material = next(item for item in sources if item["source_type"] == "feedback")
    feedback_segments = [item for item in segments if item["source_type"] == "feedback"]
    write_jsonl(root / "sources" / "sources.jsonl", sources)
    write_jsonl(root / "sources" / "transcript.jsonl", segments)
    all_evidence = list(initial_evidence.values()) + [evidence_by_key["feedback_search"]]
    write_jsonl(root / "evidence" / "evidence.jsonl", all_evidence)
    candidate = copy.deepcopy(confirmed)
    feedback = fixture["feedback"]
    target = next(item for item in candidate if item["requirement_id"] == feedback["requirement_id"])
    target.update(feedback["updates"])
    target["evidence_ids"] = list(dict.fromkeys(target["evidence_ids"] + [evidence_by_key[feedback["evidence_key"]]["evidence_id"]]))
    target["version"] = "v1.1"
    target["updated_at"] = utc_now()
    candidate_path = root / "changesets" / "candidate-v1.1.json"
    write_json(candidate_path, requirement_container(project_id, candidate))
    changeset_path = root / "changesets" / "changeset-v1.1.json"
    subprocess.run([
        sys.executable, str(SKILL_ROOT / "scripts" / "diff_requirements.py"),
        "--old", str(root / "baselines" / "v1.0.json"), "--new", str(candidate_path),
        "--output", str(changeset_path), "--project-id", project_id,
        "--source", evidence_by_key["feedback_search"]["evidence_id"],
    ], check=True)
    changeset = read_json(changeset_path)
    if len(changeset["modified"]) != 1 or changeset["conflicted"]:
        raise ValueError("Unexpected demo ChangeSet; no update applied")
    changeset.update({
        "new_baseline_id": "BASE-v1.1", "review_status": "approved",
        "approved_by": "demo-reviewer（固定样例确认）", "simulated_confirmation": True,
    })
    write_json(changeset_path, changeset)
    updated = {item["requirement_id"]: item for item in requirements}
    updated[target["requirement_id"]] = target
    requirements = list(updated.values())
    write_json(root / "requirements" / "requirements.json", requirement_container(project_id, requirements))
    new_baseline = {
        "schema_version": "1.0", "baseline_id": "BASE-v1.1", "project_id": project_id,
        "version": "v1.1", "status": "frozen", "confirmed_requirements": candidate,
        "confirmed_at": utc_now(), "confirmed_by": "demo-reviewer（固定样例确认）", "simulated_confirmation": True,
    }
    write_json(root / "baselines" / "v1.1.json", new_baseline)
    project.update({"current_baseline_id": "BASE-v1.1", "current_version": "v1.1", "updated_at": utc_now()})
    project["prototype_flow"]["owner_filter"] = True
    write_json(root / "project.json", project)
    reviews["records"].append({"action": "changeset_approved", "changeset_id": changeset["changeset_id"], "actor": "demo-reviewer", "simulated": True, "at": utc_now()})
    write_json(root / "reviews" / "review.json", reviews)
    atomic_write_text(root / "reviews" / "review.md",
        "# 固定样例评审\n\n- v1.0：模拟确认权限、名称查询和跟进时间线；历史权限冲突选择新会议规则。\n"
        "- v1.1：模拟批准客户反馈，REQ-002 增加负责人筛选和空状态。\n"
        "- 以上均为可复现夹具，不是真实客户审批；未执行外部发布。\n"
    )
    render_project(root, include_prototype=True)
    assert_valid(root)
    subprocess.run([sys.executable, str(SKILL_ROOT / "scripts" / "generate_manifest.py"), "--project", str(root)], check=True)
    return root


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=SKILL_ROOT / "examples" / "output" / "demo")
    parser.add_argument("--force", action="store_true", help="Explicitly regenerate the fixed demo output, including its demo baselines")
    args = parser.parse_args()
    try:
        root = run_demo(args.output, force=args.force)
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Demo failed: {error}\n")
    files = [path.relative_to(root).as_posix() for path in sorted(root.rglob("*")) if path.is_file()]
    print(json.dumps({"status": "success", "mode": "simulated_fixture", "project": str(root), "files": files}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
