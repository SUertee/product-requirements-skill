# 功能模块与交接

模块是职责划分，实际工具可在同一 Skill 包和宿主内组合执行。三人对照此表确定接口与实施范围。

| 模块 | 输入 | 核心处理 | 输出 | 主责建议 | 实现情况 |
| --- | --- | --- | --- | --- | --- |
| M01 输入与标准化 | 文件、录音、导出材料、项目标识 | 接收、转写适配、时间定位、去重与任务认领 | sources.jsonl、任务阶段 | B | 文本／字幕标准化已实现，ASR 与后台任务待实现 |
| M02 事实与需求理解 | 来源片段、已关联前情、原基线 | 事实分类、八要素、需求卡、疑问与冲突 | project.json 中画像与 requirements | A | 已写执行规则，自动产出待实现 |
| M03 业务数据建模 | 核对后的需求、流程与已有系统 | 角色、实体、字段、关系、状态与依据 | business_model、pages 初稿 | A | 已写建模约定，生成与检查待实现 |
| M04 方案与 PRD | 项目数据、PRD 模板 | 目标、范围、规则、异常与验收组织 | proposal.md、prd.md | A | 已有模板与输出合同，生成待实现 |
| M05 原型与内置 UI | 已确认需求、页面规范与样式依据 | 产品类型判断、布局与交互生成、页面演练 | prototype/index.html、design_context | C | 已有 UI 规范和 CSS，原型生成待实现 |
| M06 图示与 ERD | 流程／架构关系、业务实体、项目版本 | 调用 Archify 与 Schema Canvas，关联生成结果 | diagrams/*.html、data-model/index.html | C，B 协作依赖适配 | 已有依赖定位及本地实现副本，项目输入适配待实现 |
| M07 工作台汇总 | 真实产物清单、疑问、版本和来源 | 导航、预览、内容关联与评审入口 | workbench/index.html | C | 已有参考副本与 UI 规范，通用生成待实现 |
| M08 评审、版本与客户分享 | 负责人决定、客户反馈、已有基线 | 差异、锁定保护、双阶段确认、发布内容选择 | review.json、新版本、发布记录 | A，C 协作发布 | 已有规则，持久化修订与发布待实现 |

## 交接顺序

1. B 将材料标准化为可定位来源，A 消费来源并维护需求和模型。
2. A 形成方案／PRD 草稿，负责人确认核心范围与规则后交 C 生成原型。
3. C 以同一版本生成原型、图示和内部工作台，检查引用与页面行为。
4. A 汇总评审决定，C 按已确认内容发布客户版本。客户反馈回到 A 的差异处理中。

M06 可在业务模型草稿阶段先生成候选图示，最终工作台以对应版本为准。图示展示状态与原型验收分别记录。

## 实现落点

| 工作内容 | 当前权威入口 |
| --- | --- |
| 文本标准化 | product-requirements/scripts/normalize_transcript.py |
| 依赖定位 | product-requirements/scripts/resolve_capability.py、integrations.json |
| 需求与评审 | product-requirements/references/workflow.md |
| 录音与后台接入 | product-requirements/references/ingestion.md |
| 生成能力接入 | product-requirements/references/capabilities.md |
| 原型与工作台样式 | product-requirements/references/ui-design.md、assets/ui.css |
| 产物与字段 | product-requirements/references/output-contract.md |

新脚本随实际实现增加到包内 scripts/，共同字段先更新输出合同并核对消费者。功能验证后在 features 中记录实际行为与限制。
