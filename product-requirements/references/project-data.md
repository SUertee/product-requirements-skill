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


## 工作台输入

可选 modules 数组按 module_id、name、requirement_ids 组织客户业务模块，可用 goal 补充该模块的实际业务目标。module_relations 数组以 from、to 引用 module_id，label 表达交接含义，source_refs 保存关系依据。缺省为空数组，生成时保留尚无关系的模块。meetings 按 meeting_id、title、date、material_ids 组织会议；materials 按 material_id、name、kind、source_ids 和 path 组织素材；apis 按 api_id、name、method、path、requirement_ids、request、response、errors、review_status 组织接口草案。各关联引用会核对是否存在。

素材 path 为实际素材根目录内的相对路径，通过 `--materials-root` 显式选择根目录后复制到输出的 materials/。生成 HTML 自包含样式和脚本，素材文件随输出目录携带。接收器生成的 material 可包含 job_id 和 provenance.related_job_id，后者将逐字稿关联到同项目录音。workflow.py 将已关联录音一并携带到新版本，原话的 start_seconds 用于定位播放器。旧版本缺少 job_id 时按既有 JOB-ID/文件名路径识别关联，连接本地服务时也可读取接收箱内已关联的录音。

侧栏为总览、会议素材、功能需求、方案文档、原型预览、技术设计、评审记录。技术设计的流程架构、数据库和 API 通过页内标签切换。原型和图示按实际文件清单展示，初始工作台提供内部浏览和项目数据导出。人工修改和评审决定通过 Skill 进入下一轮版本。


## 会议重点

meetings 可补充 date、duration_label、url 和 highlights。highlights 为数组，每项提供 text 与非空 source_refs，引用必须属于该会议关联材料。日期和时长来自会议元数据，重点根据逐字稿提炼，并保留人工复核状态。

工作台先展示会议重点，点选时间进入逐字稿对应页；未提供重点时直接阅读逐字稿。原始来源记录保持完整，列表分页和说话人前缀的显示处理在界面完成。

## 人工文档正文

可选 document_overrides 以 proposal.md 或 prd.md 为键，值包含 content（完整 Markdown）、edited_from（基线版本）、base_sha256（原正文哈希）、source_refs（人工修订来源）。发布使用该正文替代对应自动生成文档，其他文档仍按结构化数据生成。自动分析保留已有人工正文，覆盖建议记录为 human_edited_document 冲突。正文与结构化需求分别修订。
