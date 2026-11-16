# 当前状态审计

审计基线：`main@7d5b548`。原始《产品需求落地 Skill 预赛方案书》和《skill设计文档 (1).docx》不在当前仓库，属于待补充资料；本文件不推测其内容。

| 模块 | 入口 | 输入 | 输出 | 当前完成度 |
|---|---|---|---|---|
| Skill 编排 | `SKILL.md` | 用户请求、会议与项目材料 | 路由到 references 和脚本 | 已有行为规范；九步流程的输入、检查、失败处理需进一步明确 |
| 逐字稿标准化 | `scripts/normalize_transcript.py` | UTF-8 TXT、MD、SRT、VTT | 带来源哈希、稳定片段 ID、原文和定位的 JSONL | 有实现；沙箱临时文件写入曾出现 Errno 9，需隔离验证和补测试 |
| 需求工程 | `references/workflow.md` | 来源片段与人工判断 | 八要素、REQ 卡、状态和修订约定 | 保留并统一 E0-E3、字段级锁定和增量语义 |
| 输入接入 | `references/ingestion.md` | 文件、宿主转写能力 | 标准化来源与失败说明 | 文本可处理；音频依赖宿主授权工具，不虚构 ASR |
| 输出合同 | `references/output-contract.md` | 共享项目数据 | JSONL、JSON、Markdown、HTML、manifest | 已有文件约定；需增加可执行结构及关系校验 |
| PRD | `assets/prd-template.md` | 已建模需求 | PRD 章节内容 | 模板已存在，生成由 Agent 按 Skill 执行 |
| UI | `references/ui-design.md`、`assets/ui.css`、`assets/workbench-template.html` | 已确认需求与页面规范 | 独立 HTML 工作台、原型 | 已有完整商务蓝工作台模板、内联样式、响应式导航、指标/图表、证据与 REQ 交互及 Agent 提示词弹层，由 `render_artifacts.py` 统一生成 |
| 外部能力 | `integrations.json`、`scripts/resolve_capability.py` | 环境变量或相邻依赖目录 | 外部 SKILL.md 路径 | 只定位不执行；依赖缺失时明确失败 |
| 协作与验收 | `docs/development.md` | 三人分工和联调顺序 | 开发与验收安排 | 保留，按纯 Skill 架构更新不适用内容 |
| 自动化质量 | 尚无 | 固定样例与真实执行结果 | 单元、集成、关系和交付物检查 | 本次建立 |

## 保留与边界

- 保留现有规范、八要素、REQ、证据、锁定、修订、PRD 和 UI 资产，在原文档上增量完善。
- 项目采用文件持久化和 Python 标准库辅助脚本；语义理解由兼容 Agent 执行。
- 不建设 FastAPI、Next.js、SQLite、账号、多租户或常驻服务。
- HTML 是交付文件，不是独立 Web 平台。
- 示例数据只用于开发评估，必须标记为模拟生成，不能作为真实客户处理证据。
