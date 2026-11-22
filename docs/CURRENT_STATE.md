# 当前状态审计

审计基线：`main@e43764f` 加第三轮收尾改动。原始《产品需求落地 Skill 预赛方案书》和《skill设计文档 (1).docx》不在当前仓库，属于待补充资料；本文件不推测其内容。

| 模块 | 入口 | 输入 | 输出 | 当前完成度 |
|---|---|---|---|---|
| Skill 编排 | `SKILL.md` | 用户请求、会议与项目材料 | 路由到 references 和脚本 | 九步流程已包含 REQ 质量检查、并行原型／技术设计、排期与 PPT 门禁 |
| 逐字稿标准化 | `scripts/normalize_transcript.py` | UTF-8 TXT、MD、SRT、VTT | 带来源哈希、稳定片段 ID、原文和定位的 JSONL | 已实现；原子写入改为显式 mkstemp/fdopen/os.replace，Errno 9 问题由单元与集成回归覆盖 |
| 需求工程 | `references/workflow.md`、`references/requirement-quality.md` | 来源片段与人工判断 | 八要素、REQ 卡、质量发现、状态和修订约定 | 保留并统一 E0-E3、字段级锁定和增量语义，吸收完整性／可行性／验收／优先级检查 |
| 输入接入 | `references/ingestion.md` | 文件、宿主转写能力 | 标准化来源与失败说明 | 文本可处理；音频依赖宿主授权工具，不虚构 ASR |
| 输出合同 | `references/output-contract.md`、`scripts/artifact_state.py` | 共享项目数据、生成 hash、人工批准 | JSONL、JSON、Markdown、HTML、render-state、manifest | 人工 Artifact 冲突预检零写入、逐文件批准留痕、同内容跳过、选择性渲染和 ChangeSet 内容 ID |
| PRD | `assets/prd-template.md` | 已建模需求 | 决策优先的精简 PRD | 默认省略空章节、集中未知，完整 REQ 在工作台展开 |
| UI | `references/ui-design.md`、`assets/workbench-template.html`、`assets/workbench.css`、`assets/workbench.js`、`assets/prototype-template.html` | 已确认需求与页面／交付规范 | 分支模板七模块工作台、通用交互原型、复核包、只读甘特图 | 工作台与原型 HTML 壳均接入 `feat/workflow-execution@0488753` 并适配当前 Project Data；支持 contains/exact、详情导航和归档二次确认；旧 `{{TOKEN}}` 静态模板已删除 |
| 技术设计与交付 | `references/technical-delivery.md`、`scripts/delivery_render.py`、可选 models | 技术决策、工作包、汇报大纲、Baseline | technical-design、schedule、deck-brief；真实 deck 可选 | 已实现 Schema、跨文件校验和确定性渲染；第三方 draw.io／PPTX 运行仍需真实依赖与授权 |
| 外部能力 | `integrations.json`、`scripts/resolve_capability.py` | 环境变量或相邻依赖目录 | 外部 SKILL.md 路径、固定提交与许可信息 | 支持 Archify、Schema Canvas、选定 PM Skills、Requirements Analysis、Code to Diagram、Huashu Design；只定位不执行，依赖缺失明确失败 |
| 协作与验收 | `docs/development.md` | 三人分工和联调顺序 | 开发与验收安排 | 保留，按纯 Skill 架构更新不适用内容 |
| 清理与打包 | `scripts/package_skill.py`、`dist/product-requirements-skill.zip` | 源码目录 | 字节可复现的单根目录 Skill zip + 逐文件哈希清单 | 剔除 runs、生成物、缓存、node_modules 和 .git；解压后可独立运行 CLI、演示和评估 |
| 自动化质量 | `tests/`、`tests/browser/`、`scripts/run_evals.py` | 固定样例与真实执行结果 | 单元、集成、关系、人工保护、通用原型、JS 与浏览器交互检查 | 51 项单元/集成测试通过、12 类固定评估通过；本轮 Chrome CDP 工作台 16 项与原型 12 项全通过、0 运行时错误；含人工冲突零写入、同内容不重写、选择性渲染、内容 ID 可复现、精确查询、分支 HTML 壳、浏览器夹具复现和安装包自检 |

## 保留与边界

- 保留现有规范、八要素、REQ、证据、锁定、修订、PRD 和 UI 资产，在原文档上增量完善。
- 项目采用文件持久化和 Python 标准库辅助脚本；语义理解由兼容 Agent 执行。
- 不建设 FastAPI、Next.js、SQLite、账号、多租户或常驻服务。
- HTML 是交付文件，不是独立 Web 平台。
- 示例数据只用于开发评估，必须标记为模拟生成，不能作为真实客户处理证据。
