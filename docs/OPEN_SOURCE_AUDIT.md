# 开源项目审计

审计方式：在项目外的系统临时目录浅克隆，阅读实际目录、源码、依赖和许可证；未执行第三方安装脚本，未将第三方源码复制到本 Skill。审计结论仅对应下列提交。

| 项目 | 实际能力 | 可复用代码 | 可借鉴设计 | 技术栈 | 许可证 | 最终决定 |
|---|---|---|---|---|---|---|
| AI Delivery Spec `e76b550` | SKILL、需求/原型 references、40 余个确定性 Python 检查脚本、示例与维护评估；覆盖变更、追溯和人工门禁 | 本次不复制；后续若复制具体脚本须保留 MIT 声明 | 最小充分规格、稳定需求身份、受影响范围复验、来源优先于生成代码 | Python、YAML/JSON、HTML | MIT，已读 LICENSE | 只参考设计 |
| PRD Agents `157602b` | `run.py` 顺序调用 OpenAI；Librarian 汇总 context，Chief 生成 notes，PRD Writer、CFO、COO 生成产物 | 无；代码存在重复 Librarian 调用，JSON 失败会回退自由文本 | Context Pack、按职责顺序协同；本项目不照搬多 Agent 数量 | Python、OpenAI、dotenv，可选 openpyxl/python-pptx | MIT，已读 LICENSE | 只参考设计 |
| PM Copilot `0f9e407` | pnpm monorepo：共享 core、local-server、manager-web、Codex 插件；Markdown 需求库和受限写入 | 无，许可证未确认 | 唯一需求对象、项目文件组织、读取与写入分离、稳定 ID | Node 24、TypeScript、pnpm、本地服务 | 未找到 LICENSE；README 不构成复制授权 | 只参考设计 |
| PRD-to-Prototype `49434d8` | LangGraph + Pydantic；PRD/story/prototype 状态、19 项左右确定性检查、LLM 评价、修复和 Golden Dataset | 无；不引入其 FastAPI/Next.js/LangGraph 技术栈 | PRD 与原型共享 REQ 和验收标准、页面可达性检查、证据引用机械核验、保留最佳修订 | Python 3.13、LangGraph、Pydantic、FastAPI、Next.js | MIT，已读 LICENSE | 只参考设计 |
| Chalky PRD `e668c6d` | 访谈型 Skill；PRD、build notes、近逐字 transcript 分离，草稿停止门禁和开放问题规则 | 无；本项目自行实现文件结构 | 原话不改写、事实/假设分离、缺口显式保留、确认后才进入构建 | Markdown Skill | MIT，已读 LICENSE | 只参考设计 |
| TraceX Backend `e49370b` | Google ADK 七 Agent 顺序流水线、FastAPI 上传、测试/边界/合规/追溯/集成模块和 MCP 工具 | 无，许可证未确认且不引入后台 | 需求到验收用例和异常分支的追溯思路 | Python 3.11、Google ADK、FastAPI、GCP、MCP | 未找到 LICENSE；README 仅写教育演示用途 | 只参考设计 |
| AI PRD Builder `48b10c7` | 纯 Markdown Skill；分段访谈、显式 CP/Gate、外部活清单、运行日志和测试提示 | 无，许可证未确认 | 检查点无回复即等待、独立质量清单、固定测试提示、Skill 文件组织 | Markdown、Claude Skill | 未找到 LICENSE | 只参考设计 |

## 实际吸收的设计

- 用共享 REQ 和验收标准驱动 PRD、页面和原型，避免分别发挥。
- 将证据引用、ID、时间戳、页面关联和版本检查做成标准库确定性脚本。
- 将团队确认、Baseline、ChangeSet 和客户发布保留为显式人工门禁。
- 将原始 Transcript、Evidence、Requirement 和生成 Artifact 分开保存。
- 使用固定案例与真实 Agent 执行两种评估，不以文件存在代替内容质量。

## 未采用

没有直接复用第三方代码，没有引入七套运行时，没有增加 FastAPI、Next.js、SQLite、LangGraph 或 Node 依赖。外部仓库测试未在本项目环境执行：本次目的是设计审计，且多个项目需要专有模型凭据或完整应用依赖；不能以 README 的测试数量代替本地验证。
