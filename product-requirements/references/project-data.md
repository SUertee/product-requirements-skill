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

生成 project.json、sources.jsonl、proposal.md、prd.md、review.json、workbench/index.html 和 manifest.json。已有输出目录会返回错误，选择新版本目录后再执行。需求中的人工锁定字段随项目数据原样保存。

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


## 工作台扩展字段

| 字段 | 约定 |
| --- | --- |
| modules | 客户项目功能模块数组，每项提供 module_id、name 和 requirement_ids。需求通过稳定 REQ ID 归入模块 |
| meetings | 会议数组，每项提供 meeting_id，可补 title、date 和 material_ids |
| materials | 素材数组，每项提供 material_id，可补 name、kind、source_ids 和 path |
| apis | 接口草案数组，每项提供 api_id，可补 name、method、path、requirement_ids、request、response、errors 和 review_status |

模块与 API 的需求引用、素材的来源引用、会议的素材引用会校验是否存在。已有项目缺少这些扩展字段时继续显示现有需求与来源。

素材的 path 为相对选定素材根目录的文件路径。需要随输出携带文件时，在生成命令增加 `--materials-root 实际素材目录`。音频、文档和常用图片复制到输出的 materials/，工作台提供文件入口，音频提供播放器。导入范围以显式根目录为准，路径跳出该范围时返回错误。

工作台使用 ParTrace Vision workbench 的侧栏、内容区和样式基础，增加会议素材、需求来源关联、搜索、状态筛选和项目 JSON 导出。初始界面提供内部浏览，评审决定通过 Skill 进入后续版本。原型、图示与交互 ERD 入口以实际产物清单为准。
