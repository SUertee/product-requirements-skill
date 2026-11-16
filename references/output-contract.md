# 输出合同 v1.0

## 文件型共享项目

每次运行写入用户指定项目目录，而非 Skill 安装目录。标准结构如下；仅有实际内容时创建可选图示目录。

```text
project/
├── project.json
├── sources/{sources.jsonl,transcript.jsonl}
├── evidence/evidence.jsonl
├── requirements/requirements.json
├── models/business-model.json
├── baselines/v1.0.json
├── artifacts/{proposal.md,prd.md,agent-prompt.md,workbench/index.html,prototype/index.html}
├── reviews/{review.md,review.json}
├── changesets/changeset-v1.1.json
└── manifest.json
```

Source、TranscriptSegment、Evidence、Requirement 必须独立；稳定 ID 分别为 SRC、SEG、EVD、REQ 前缀。`requirements.json` 是对象，包含 `schema_version`、`project_id`、`requirements` 数组。`business-model.json` 至少包含 `roles`、`workflows`、`entities`、`rules`、`states`、`integrations`。`reviews/review.json` 包含 `records`，记录确认、人工修改、锁定与解锁。

Schema 位于 Skill 的 `schemas/`。写入后运行 `python scripts/validate_project.py --project <项目目录>`；证据可单独运行 `validate_evidence.py`。所有 JSON/JSONL 写入必须同目录临时文件完整关闭后原子替换，不能先清空旧文件。重复运行先读当前 REQ 最大编号和锁定字段。

以下为原有产物约定，继续有效。

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
