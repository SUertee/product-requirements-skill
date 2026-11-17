# 输出合同 v0.1

每个客户项目生成到独立目录。原始录音与客户资料存放在本地运行目录。

| 文件 | 内容 |
| --- | --- |
| sources.jsonl | 来源片段、材料标识、原文、时间或段落定位与来源版本 |
| project.json | 项目标识、版本、前情关联、八要素、需求卡、业务模型、页面规格与人工锁定 |
| proposal.md | 目标、范围、流程与实现思路 |
| prd.md | 按 assets/prd-template.md 生成的内部产品需求文档 |
| workbench/index.html | 内部总览、来源、需求、PRD、模型、规范与评审入口 |
| prototype/index.html | 基于确认版本生成的核心任务交互原型 |
| diagrams/*.html | Archify 生成的流程与架构图，实际生成时加入工作台 |
| data-model/index.html | Schema Canvas 交互式 ERD，记录模型来源和版本 |
| review.json | 疑问、冲突、变更差异、影响范围与人工确认 |
| diff.json | 新旧版本字段差异、锁定冲突与修订依据 |
| generation.json | 实际生成项、检查及独立失败原因 |
| manifest.json | 文件状态、版本、依赖、生成信息、受众、检查和发布结果 |

`project.json` 最少包含 project_id、schema_version、artifact_version、baseline_version、context_sources、requirement_profile、requirements、business_model、pages、design_context。requirements 使用 workflow.md 的需求卡字段。模型中区分 logical 与 foreign_key 关系，外键依据真实数据库定义。

manifest 各项记录 path、generation_status（success／partial／failed）、review_status（draft／reviewed）、artifact_version、depends_on、source_ids、generator 和 validation_results。仅在实际生成时登记 success。模型版本无法取得时使用 unknown。

原型依赖对应的已确认 PRD 与页面规范版本。部署后记录实际 URL 和发布版本，内部资料默认保持内部受众。

## 检查

来源引用存在，REQ ID 唯一稳定，页面关联有效。生成 HTML 使用 textContent 等安全方式显示导入文本。相对资源路径在本地与部署后均可解析。检查正常、空态和错误分支，保留真实验收结果。

若采用 schema-canvas，记录 ERD 来源与生成版本。技术模块按实际内容启用。草稿、确认基线、示例数据及真实接口状态清楚标明。


## 组合能力的追溯

manifest 记录实际调用的 Skill、固定版本或提交、输入数据版本和关联图示。review.json 分别记录方案／PRD 确认与客户分享前的最终复核。UI 设计依据、产品类型和参考来源进入 project.json 的 design_context。


## 内置界面样式

原型与工作台使用 assets/ui.css 和 references/ui-design.md，按输出文件位置复制样式并设置可部署的相对路径。design_context.design_system_version 记录内置版本和项目覆盖，页面中展示的原型仍关联确认后的需求版本。


## 当前文档生成入口

结构化项目输入与实际命令见 [项目输入规范](project-data.md)。build_documents.py 已实现输入结构和引用检查、PRD／方案生成、初始评审问题及产物清单。整体文档以 draft 输出，工作台同步生成。workflow.py 编排分析、评审应用、业务流程／ERD／原型生成和客户包，各项登记实际结果。客户包状态与部署 URL 分别记录。操作见 [运行流程](execution.md)。


## 工作台生成

build_documents.py 按项目数据生成 workbench/index.html。功能模块、会议、素材和 API 的扩展字段及附件目录约定见 [项目输入规范](project-data.md)。工作台只从实际产物清单构建文件入口，未生成内容显示相应状态。
