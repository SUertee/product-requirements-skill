# 项目数据与运行契约

2026-11-17 的字段设计。来源标准化、文档生成、本地接收任务及评审意见存储已实现，自动分析调度、增量应用与发布字段仍按候选合同维护。产物清单及状态枚举统一沿用 [输出合同](../../product-requirements/references/output-contract.md)。

## 来源片段

当前 normalize_transcript.py 每行输出 source_id、project_id、material_id、source_name、source_type、text、locator、speaker 和 schema_version。

- material_id 为输入文件内容的 SHA-256。
- source_id 由项目、材料摘要和片段序号派生，同一输入重复运行保持一致。
- locator 对普通文本使用 paragraph，对字幕使用 start_seconds、end_seconds 与 cue。
- speaker 当前为 null，后续转写适配器需要保留匿名说话人及实际来源信息。

来源类型与时间定位能力随实际输入标明。未知说话人保留匿名标识，素材变更形成新的材料标识。

## 共享项目数据

| 字段 | 约定 | 主要消费者 |
| --- | --- | --- |
| project_id、schema_version | 项目标识与结构版本 | 所有模块 |
| artifact_version、baseline_version | 当前成果版本与所依据基线 | 生成、评审与发布 |
| context_sources | 前情材料引用、版本与关联确认 | M02、M03 |
| requirement_profile | 八要素与证据定位 | M04、M07 |
| requirements | 稳定 REQ ID、行为、规则、验收、source_refs、证据类型、确认状态及锁定字段 | M03—M08 |
| business_model | 实体、字段、关系、状态、约束及来源，区分逻辑关系和真实外键 | M05、M06 |
| pages | 页面任务、状态、字段、操作与 REQ ID | M05、M07 |
| design_context | 产品类型、目标设备、样式来源、参考产品、内置规范版本及设计选择 | M05、M07 |

REQ ID 在材料更新后保持业务身份稳定，合并或拆分时记录对应关系。人工锁定保护到具体字段，新材料与锁定内容冲突时生成待确认差异。

## 评审记录与双阶段确认

review.json 记录待确认问题、差异、来源、影响范围及决定。每条决定建议包含 decision_id、review_stage、reviewer、decided_at、baseline_version、artifact_version、affected_ids 和 outcome。

- definition 对应方案／PRD 的范围、规则和验收确认。
- release 对应最终原型、工作台、客户可见内容与发布版本的确认。

确认必须绑定实际版本。影响核心行为的新反馈回写数据后，对关联成果重新评审。系统记录谁确认了什么以及保留的遗留问题。

## 后台任务与失败恢复

沿用 ingestion.md 的 received、normalized、analyzed、draft_ready、failed 阶段。本地接收任务实际记录 job_id、project_id、material_id、processor_version、stage、status、files、provenance、created_at 和失败 error。文本完成后 stage 为 normalized、status 为 ready_for_analysis；音轨提取后 stage 为 audio_ready、status 为 awaiting_transcript。失败重试保留原任务并通过 retry_of 关联新尝试。input_version、attempt 与 checkpoint_refs 作为后续后台调度字段。

执行器先确认文件稳定，再按材料、项目和处理版本去重并原子认领。完成阶段产物先写临时文件，校验后发布引用。重试复用完成阶段，继续时核对输入与基线版本。晚到结果在其原始运行版本中保存，切换当前版本由编排层确认。

任务阶段、产物生成状态、人工评审状态和部署结果各自记录。依赖不可用、转写失败或输出无效时，保留已有结果、失败阶段和可恢复入口。

## 本地评审意见

运行器将意见保存到接收 workspace 的 reviews.sqlite3，以 project_id 和 artifact_version 为键，revision 检查覆盖冲突。每条记录包含目标、definition 阶段、结论、意见、可为空的记录人和时间。导出 review-notes.json 后交给 Skill 结合基线修订，既有生成目录保留。

## 发布与外部生成器

Archify 和 Schema Canvas 使用同一项目版本的业务模型或图示输入，记录实际生成器、提交或版本、输入摘要、输出入口及检查结果。

发布清单记录用户选择的文件、版本与实际部署 URL。工作台内部资料与客户原型按发布选择确定受众，发布前检查资源路径和数据范围。发布失败时记录失败，成功链接以真实返回结果为准。
