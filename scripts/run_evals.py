#!/usr/bin/env python3
"""Validate eval definitions and execute the fixed end-to-end demo assertions."""
import argparse
import copy
import json
from pathlib import Path
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
    assert "customer-query" in prototype and "owner-query" in prototype and "返回客户列表" in prototype
    assert '"owner_filter": true' in prototype
    manifest = read_json(root / "manifest.json")
    prototype_entry = next(item for item in manifest["artifacts"] if item["artifact_path"] == "artifacts/prototype/index.html")
    assert prototype_entry["requirement_ids"] == ["REQ-001", "REQ-002", "REQ-003"], "Prototype must not trace parked requirements"
    historical = (root / "artifacts" / "versions" / "v1.0" / "prototype" / "index.html").read_text(encoding="utf-8")
    assert '"owner_filter": false' in historical, "v1.0 prototype snapshot must remain on the old behavior"


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
