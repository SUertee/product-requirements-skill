#!/usr/bin/env python3
"""Validate eval definitions and execute the fixed end-to-end demo assertions."""
import argparse
import copy
import json
from pathlib import Path
import re
import tempfile

from project_lib import SKILL_ROOT, load_requirements, read_json, read_jsonl
from run_demo import run_demo


def check_cases():
    cases = read_json(SKILL_ROOT / "evals" / "test-cases.json")["cases"]
    assert len(cases) >= 10, "At least ten eval cases are required"
    ids = [case["id"] for case in cases]
    assert len(ids) == len(set(ids)), "Eval case IDs must be unique"
    for case in cases:
        for key in ["input", "expected", "must_preserve_quotes", "expected_req", "expected_files", "checks"]:
            assert key in case, f"{case['id']} missing {key}"
        for quote in case["must_preserve_quotes"]:
            assert quote in json.dumps(case["input"], ensure_ascii=False), f"{case['id']} quote is not in input"
    return len(cases)


def prototype_data(path):
    text = Path(path).read_text(encoding="utf-8")
    match = re.search(r'<script id="prototype-data" type="application/json">(.*?)</script>', text, re.DOTALL)
    if not match:
        raise AssertionError("Generic prototype data is missing")
    return json.loads(match.group(1))


def check_demo(root, expectations):
    for relative in expectations["required_files"]:
        assert (root / relative).is_file(), f"Missing demo output {relative}"
    project = read_json(root / "project.json")
    assert project["current_version"] == expectations["expected_project_version"]
    requirements = {item["requirement_id"]: item for item in load_requirements(root)}
    for req_id, expected in expectations["expected_requirements"].items():
        actual = requirements[req_id]
        for key, value in expected.items():
            if key == "evidence_minimum":
                assert len(actual["evidence_ids"]) >= value
            else:
                assert actual[key] == value, f"{req_id}.{key}: {actual[key]!r} != {value!r}"
    evidence_text = json.dumps(read_jsonl(root / "evidence" / "evidence.jsonl"), ensure_ascii=False)
    for quote in expectations["required_quotes"]:
        assert quote in evidence_text, f"Evidence quote missing: {quote}"
    changeset = read_json(root / "changesets" / "changeset-v1.1.json")
    assert len(changeset["modified"]) == expectations["changeset"]["modified"]
    assert len(changeset["conflicted"]) == expectations["changeset"]["conflicted"]
    assert changeset["simulated_confirmation"] is True
    prd = (root / "artifacts" / "prd.md").read_text(encoding="utf-8")
    agent_prompt = (root / "artifacts" / "agent-prompt.md").read_text(encoding="utf-8")
    assert "REQ-002" in agent_prompt and "disputed/parked 必须先澄清" in agent_prompt
    assert "先审计当前项目" in agent_prompt and "EVD-" in agent_prompt
    prototype = (root / "artifacts" / "prototype" / "index.html").read_text(encoding="utf-8")
    assert "REQ-002" in prd and "负责人筛选" in prd
    assert "示例数据" in prototype and "模拟接口" in prototype and "REQ-002" in prototype
    prototype_payload = prototype_data(root / "artifacts" / "prototype" / "index.html")
    customer_page = next(page for page in prototype_payload["pages"] if page["page_id"] == "customer-list")
    query_field_ids = [field["id"] for field in customer_page["query"]["fields"]]
    assert "name" in query_field_ids and "owner" in query_field_ids and "返回客户列表" in prototype
    assert customer_page["query"]["match_rule"] == "contains"
    manifest = read_json(root / "manifest.json")
    workbench = (root / "artifacts" / "workbench" / "index.html").read_text(encoding="utf-8")
    for label in ["项目总览", "会议素材", "功能模块", "方案文档", "原型", "技术设计", "评审记录"]:
        assert label in workbench, f"Workbench module missing: {label}"
    for view_id in ["overview", "materials", "modules", "documents", "technical", "review"]:
        assert f"'{view_id}'" in workbench, f"Workbench view missing: {view_id}"
    assert "__WORKBENCH_" not in workbench and "wb-review-check" in workbench and "buildReviewPackage" in workbench
    assert "req_revision" in workbench and "Baseline 尚未修改" in workbench
    technical = (root / "artifacts" / "technical-design.md").read_text(encoding="utf-8")
    assert "候选" in technical and "未执行 code-to-diagram" in technical
    schedule = (root / "artifacts" / "schedule" / "index.html").read_text(encoding="utf-8")
    assert "WORK-004" in schedule and "待排期" in schedule and "schedule-bar" in schedule and "{{" not in schedule
    brief = (root / "artifacts" / "deck-brief.md").read_text(encoding="utf-8")
    assert "不是 PPT 成品" in brief and "尚未执行真实" in brief
    artifact_types = {item["artifact_type"] for item in manifest["artifacts"]}
    assert {"technical_design", "schedule", "deck_brief", "diagram"} <= artifact_types
    assert "deck" not in artifact_types, "Demo must not claim an unexecuted PPT export"
    assert not any(item["artifact_path"].lower().endswith(".pptx") for item in manifest["artifacts"])
    prototype_entry = next(item for item in manifest["artifacts"] if item["artifact_path"] == "artifacts/prototype/index.html")
    assert prototype_entry["requirement_ids"] == ["REQ-001", "REQ-002", "REQ-003"], "Prototype must not trace parked requirements"
    historical = (root / "artifacts" / "versions" / "v1.0" / "prototype" / "index.html").read_text(encoding="utf-8")
    historical_payload = prototype_data(root / "artifacts" / "versions" / "v1.0" / "prototype" / "index.html")
    historical_page = next(page for page in historical_payload["pages"] if page["page_id"] == "customer-list")
    historical_query_ids = [field["id"] for field in historical_page["query"]["fields"]]
    assert "owner" not in historical_query_ids, "v1.0 prototype snapshot must not expose the owner filter"
    assert "owner" in query_field_ids, "v1.1 prototype must expose the owner filter"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--demo-project", type=Path, help="Existing demo output; omit to execute a fresh demo in a temporary directory")
    args = parser.parse_args()
    count = check_cases()
    expectations = read_json(SKILL_ROOT / "examples" / "expected-output" / "expectations.json")
    if args.demo_project:
        check_demo(args.demo_project, expectations)
        output = str(args.demo_project)
    else:
        with tempfile.TemporaryDirectory(prefix="prd-skill-evals-") as temporary:
            root = run_demo(Path(temporary) / "project")
            check_demo(root, expectations)
            output = "fresh temporary demo (passed)"
    print(json.dumps({"status": "passed", "case_definitions": count, "demo": output}, ensure_ascii=False))


if __name__ == "__main__":
    main()
