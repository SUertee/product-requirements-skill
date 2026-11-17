# 结构化项目输入 v0.1

build_documents.py 消费 project.json 与 sources.jsonl，生成内部文档草稿。主 Skill 根据会议材料整理结构化项目，人工或模型提供的字段均接受同一套引用校验。

## 调用

从仓库根目录执行，输入路径替换为实际文件，输出目录使用新的项目版本。

```bash
python3 product-requirements/scripts/build_documents.py \
  --project runs/input/project.json \
  --sources runs/input/sources.jsonl \
  --output runs/demo/v0.1
```

生成 project.json、sources.jsonl、proposal.md、prd.md、review.json 和 manifest.json。已有输出目录会返回错误，选择新版本目录后再执行。需求中的人工锁定字段随项目数据原样保存。

## 项目字段

| 字段 | 类型与约定 |
| --- | --- |
| project_id | 非空字符串，与来源片段的 project_id 一致 |
| name | 可选项目名称，缺省使用项目标识 |
| schema_version | 当前支持字符串 0.1 |
| artifact_version | 非空成果版本字符串 |
| baseline_version | 已有基线版本字符串，新项目使用 null |
| context_sources | 前情来源数组 |
| requirement_profile | 下表的八要素对象，缺少项进入待确认清单 |
| requirements | 需求卡数组 |
| business_model | 业务模型对象，尚未整理时使用空对象 |
| pages | 页面数组，尚未整理时使用空数组 |
| design_context | 产品类型与内置样式依据对象 |

八要素键名使用 customer_and_roles、business_scenario、pain_points、desired_outcomes、scope、constraints、integrations、evidence_and_questions。内容可使用文本或结构化值，未知使用 null。

## 需求与页面

需求卡必须提供 requirement_id、title、source_refs、evidence_type 和 review_status。source_refs 为实际来源 ID 数组。explicit、inferred 和 suggested 需要支持来源，unknown 可以先留空来源并进入评审。

行为字段使用 role、trigger、behavior、inputs、outputs、rules、exceptions、acceptance_criteria。缺失字段进入待确认清单。locked_fields 可记录当前对象中已人工锁定的字段名。

页面提供唯一 page_id 和 requirement_ids 数组，引用当前项目实际存在的需求。证据分类、确认状态沿用 [需求建模](workflow.md) 的枚举。

## 生成与失败

工具按 [PRD 模板](../assets/prd-template.md) 的章节生成内容，补充原始依据和定位。整体文档和初始 review 均为 draft，已有需求确认状态保存在 project.json 中。

引用无效、重复 ID 或项目归属不一致时返回错误。写入采用同目标目录的排他构建锁和临时目录，生成失败清理中间目录；进程被强制终止后遗留锁需要先确认任务已结束再处理。工具负责结构与引用检查，语义正确性由人工评审与后续端到端验证确认。
