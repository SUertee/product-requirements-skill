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

工具按 [项目方案模板](../assets/document-templates.md) 与 [PRD 模板](../assets/document-templates.md) 的章节生成内容，补充原始依据和定位。整体文档和初始 review 均为 draft，已有需求确认状态保存在 project.json 中。

引用无效、重复 ID 或项目归属不一致时返回错误。写入采用同目标目录的排他构建锁和临时目录，生成失败清理中间目录；进程被强制终止后遗留锁需要先确认任务已结束再处理。工具负责结构与引用检查，语义正确性由人工评审与后续端到端验证确认。


## 工作台输入

可选 modules 数组按 module_id、name、requirement_ids 组织客户业务模块，可用 goal 补充该模块的实际业务目标。module_relations 数组以 from、to 引用 module_id，label 表达交接含义，source_refs 保存关系依据。缺省为空数组，生成时保留尚无关系的模块。meetings 按 meeting_id、title、date、material_ids 组织会议；materials 按 material_id、name、kind、source_ids 和 path 组织素材；apis 按 api_id、name、method、path、requirement_ids、request、response、errors、review_status 组织接口草案。各关联引用会核对是否存在。

素材 path 为实际素材根目录内的相对路径，通过 `--materials-root` 显式选择根目录后复制到输出的 materials/。生成 HTML 自包含样式和脚本，素材文件随输出目录携带。接收器生成的 material 可包含 job_id 和 provenance.related_job_id，后者将逐字稿关联到同项目录音。workflow.py 将已关联录音一并携带到新版本，原话的 start_seconds 用于定位播放器。旧版本缺少 job_id 时按既有 JOB-ID/文件名路径识别关联，连接本地服务时也可读取接收箱内已关联的录音。

侧栏为总览、会议素材、功能需求、方案文档、原型预览、技术设计、评审记录。技术设计的流程架构、数据库和 API 通过页内标签切换。原型和图示按实际文件清单展示，初始工作台提供内部浏览和项目数据导出。人工修改和评审决定通过 Skill 进入下一轮版本。


## 会议重点

meetings 可补充 date、duration_label、url 和 highlights。highlights 为数组，每项提供 text 与非空 source_refs，引用必须属于该会议关联材料。日期和时长来自会议元数据，重点根据逐字稿提炼，并保留人工复核状态。

会议重点可选 `status`，支持 `decided`、`conditional`、`proposal` 和 `pending`。工作台先展示会议重点，点选时间在原话面板定位并显示相邻片段，完整逐字稿可一键跳到对应页。未提供重点时直接阅读逐字稿。原始来源记录保持完整，列表分页和说话人前缀的显示处理在界面完成。

## 人工文档正文

可选 document_overrides 以 proposal.md 或 prd.md 为键，值包含 content（完整 Markdown）、edited_from（基线版本）、base_sha256（原正文哈希）、source_refs（人工修订来源）。发布使用该正文替代对应自动生成文档，其他文档仍按结构化数据生成。自动分析保留已有人工正文，覆盖建议记录为 human_edited_document 冲突。正文与结构化需求分别修订。

## 非功能需求与原型设计

可选 nfrs 记录性能、权限、设备、可靠性、审计等非功能需求，结构与需求卡一致并使用 NFR-ID。可选 prototype_design 记录项目定位、角色、页面、示例数据和页面内容。两者的字段、检查规则和生成方式见 [原型设计与生成](prototype.md)。NFR 在工作台“功能需求”列表中单独成组，和功能需求一样就地评审（确认／需要修改／暂缓），生成新版本后状态生效。

## 技术架构

可选 technical_architecture 独立于 modules 和 business_model.flows。layers 为带唯一 id、name 的层次；components 为带唯一 id、name、layer 的组件，可用 runtime 说明运行环境；connections 以 from、to 连接实际组件。review_status 默认 draft，requirement_ids 和 source_refs 关联已有需求和来源。层次与组件身份、连接端点及引用均经输入校验。

技术架构用于说明实现组件、运行边界与连接，不能把业务流程步骤直接改名为架构。待确认的工程建议标明 evidence_type=suggested 与 draft。通过 architecture 生成任务适配到 Archify，工作台沙箱嵌入产物并按内容高度调整；没有产物时以基础 SVG 展示。用例图来自需求角色和功能名称，只表达需求中的角色关联，不推导权限模型、include 或 extend 关系。

组件详情可补充 responsibility（一句职责）、development_items（开发内容文本数组）、delivery_criteria（交付标准文本数组）、requirement_ids 和 source_refs。引用必须存在，内容类型经过校验。未提供时显示待补充，交付标准不代表验收已通过。

## 输出合同 v0.1

每个客户项目生成到独立目录。原始录音与客户资料存放在本地运行目录。

| 文件 | 内容 |
| --- | --- |
| sources.jsonl | 来源片段、材料标识、原文、时间或段落定位与来源版本 |
| project.json | 项目标识、版本、前情关联、八要素、需求卡、业务模型、页面规格与人工锁定 |
| proposal.md | 目标、范围、流程与实现思路 |
| prd.md | 按 assets/document-templates.md 生成的内部产品需求文档 |
| workbench/index.html | 内部总览、来源、需求、PRD、模型、规范与评审入口 |
| prototype/index.html | 基于确认版本生成的核心任务交互原型 |
| diagrams/*.html | Archify 生成的流程与架构图，实际生成时加入工作台 |
| data-model/index.html | Schema Canvas 交互式 ERD，记录模型来源和版本 |
| review.json | 疑问、冲突、变更差异、影响范围与人工确认 |
| diff.json | 新旧版本字段差异、锁定冲突与修订依据 |
| generation.json | 实际生成项、检查及独立失败原因；沿用上一版的项带 reused_from |
| history.json | 版本记录：每一版的来源版本、类型、评审结论、变化数和成果，逐版累积 |
| manifest.json | 文件状态、版本、依赖、生成信息、受众、检查和发布结果 |

`project.json` 最少包含 project_id、schema_version、artifact_version、baseline_version、context_sources、requirement_profile、requirements、business_model、pages、design_context。requirements 使用 workflow.md 的需求卡字段。模型中区分 logical 与 foreign_key 关系，外键依据真实数据库定义。

manifest 各项记录 path、generation_status（success／partial／failed）、review_status（draft／reviewed）、artifact_version、depends_on、source_ids、generator 和 validation_results。仅在实际生成时登记 success。模型版本无法取得时使用 unknown。

原型依赖对应的已确认 PRD 与页面规范版本。部署后记录实际 URL 和发布版本，内部资料默认保持内部受众。

### 检查

来源引用存在，REQ ID 唯一稳定，页面关联有效。生成 HTML 使用 textContent 等安全方式显示导入文本。相对资源路径在本地与部署后均可解析。检查正常、空态和错误分支，保留真实验收结果。

若采用 schema-canvas，记录 ERD 来源与生成版本。技术模块按实际内容启用。草稿、确认基线、示例数据及真实接口状态清楚标明。


### 组合能力的追溯

manifest 记录实际调用的 Skill、固定版本或提交、输入数据版本和关联图示。review.json 分别记录方案／PRD 确认与客户分享前的最终复核。UI 设计依据、产品类型和参考来源进入 project.json 的 design_context。


### 内置界面样式

原型与工作台使用 assets/ui.css 和 references/ui-design.md，按输出文件位置复制样式并设置可部署的相对路径。design_context.design_system_version 记录内置版本和项目覆盖，页面中展示的原型仍关联确认后的需求版本。


### 当前文档生成入口

结构化项目输入与实际命令见 [项目输入规范](project-data.md)。build_documents.py 已实现输入结构和引用检查、PRD／方案生成、初始评审问题及产物清单。整体文档以 draft 输出，工作台同步生成。workflow.py 编排分析、评审应用、业务流程／ERD／原型生成和客户包，各项登记实际结果。客户包状态与部署 URL 分别记录。操作见 [运行流程](execution.md)。


### 工作台生成

build_documents.py 按项目数据生成 workbench/index.html。功能模块、会议、素材和 API 的扩展字段及附件目录约定见 [项目输入规范](project-data.md)。工作台只从实际产物清单构建文件入口，未生成内容显示相应状态。
