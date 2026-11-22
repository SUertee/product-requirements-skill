# 技术设计、排期与汇报交付

技术设计、排期和 PPT 都是共享项目数据的不同成果视图。它们必须关联项目版本、Baseline 和 REQ ID，不得各自复制一套需求事实。

## 可选模型

| 文件 | 唯一职责 | 不允许 |
| --- | --- | --- |
| `models/technical-design.json` | 候选／已确认技术决策、图示及其验证状态 | 把候选架构写成已存在代码或客户确认事实 |
| `models/delivery-plan.json` | 工作包、REQ、负责人、依赖、日期与排期状态 | 缺少人力或日期时编造精确计划 |
| `models/deck-brief.json` | 汇报对象、目标、页面大纲、内容依据和导出状态 | 把简报或 HTML 草稿登记成已导出的 PPTX |

模型均为可选。旧项目没有这些文件时继续正常校验和渲染；只有模型实际存在时才生成对应成果。

## 技术设计

需求 Baseline 后，技术设计与原型可并行。技术设计至少按真实信息覆盖：

- 设计目标、范围及关联 REQ；
- 组件、数据、接口、权限和外部依赖；
- 核心时序及正常、可选、异常分支；
- 候选技术决策、理由、未知和待确认；
- 与现有代码、数据库或部署环境的核对状态。

### 图示路由

| 类型 | 首选能力 | 输出与证据边界 |
| --- | --- | --- |
| 业务流程、架构图 | Archify | 按既有接入生成 HTML；记录生成版本和输入模型 |
| 交互式 ERD | Schema Canvas | 区分逻辑关系与已验证数据库外键 |
| 时序图、状态图、类图、代码结构图 | `code-to-diagram` | 保留 `.mmd`、实际 `.drawio`、`.png` 和检查结果 |

`code-to-diagram` 使用 `CODE_TO_DIAGRAM_SKILL_DIR` 或工程旁 `skill-dependencies/code-to-diagram`。真实入口位于 `skills/code-to-diagram/SKILL.md`，通过 `python scripts/resolve_capability.py code-to-diagram` 获取。

从需求生成候选时序图时：

1. 只画一个需要回答的问题，参与者、消息和分支关联技术决策或 REQ。
2. `.mmd` 可保存为设计输入；没有真实构建成功时，图示状态保持 `draft`。
3. 其源码名称和 import 检查只适用于真实源代码。会议与方案输入没有 `file:line` 时，不得宣称“已由源码事实核验”。
4. 只有实际命令成功且输出存在时才写 `generated`；完成布局与内容复核后才写 `verified`。
5. 外部能力失败保留技术设计正文和其他成果，记录失败，不返回旧 PNG 冒充新结果。

## 排期甘特图

`models/delivery-plan.json` 是唯一排期输入。每个工作包关联一个或多个 REQ，并明确：

- `proposed`：建议工作包，可以缺少负责人或日期；
- `confirmed`：负责人、起止日期已经人工确认；
- `in_progress`／`completed`／`blocked`：有真实执行依据的状态。

日期使用 ISO `YYYY-MM-DD`。起止日期必须成对出现且结束不早于开始；依赖引用同一计划内的 `work_id`，不能自依赖。缺日期的工作包进入“待排期”，不分配到虚构日期。

`render_artifacts.py` 将该模型确定性渲染为 `artifacts/schedule/index.html`，复用内置 UI 样式。甘特图是只读排期视图，不是另一个 Agent Skill，也不直接修改计划。修改由 Agent 形成新模型或 ChangeSet，经确认后重渲染。

排期变化只重算受影响的摘要、甘特图和 PPT 简报，不重写无关 REQ。

## PPT 简报与导出

`artifacts/deck-brief.md` 是 `huashu-design` 的受控输入，不是 PPT 成品。默认只保留决策所需页面：背景与痛点、目标、用户价值、范围、核心流程、关键功能、原型、技术方案、排期、风险与下一步；无内容页面省略。

实际生成 PPT 前：

1. 选择已确认 Baseline 和汇报对象；内部证据、客户可见内容和模拟数据严格区分。
2. 简报 `review_status` 必须为 `approved`，发布门禁必须明确通过。
3. 通过 `python scripts/resolve_capability.py huashu-design` 定位完整 Skill，读取 deck 模块及导出参考。
4. 遵循其视觉方向选择流程；同一项目记录已选方向，版本更新优先复用，不重复做无关风格探索。
5. 实际执行环境检查、渲染和导出。只有真实 `.pptx` 或 HTML deck 文件存在且检查完成后，才更新 `export_status` 和 manifest。

缺少 Node、浏览器、PPTX 依赖或完整 Skill 时，保留简报并报告未导出。不得用 Markdown 改后缀、空文件或旧版本文件表示成功。`huashu-design` 的演示贴纸等单独许可素材不进入客户交付，使用项目自有或明确授权素材。

### 本地 PptxGenJS 兜底导出

完整 `huashu-design` 不可用、但需要先验证内部汇报链路时，可使用固定版本的 PptxGenJS 兜底。该路径生成可编辑文本框 PPTX 和带逐页讲解提示的 HTML deck，生成器记录为 `pptxgenjs`，不能写成 huashu-design 成果。

```bash
npm install
node scripts/export_deck_pptx.mjs --project <项目目录>
```

导出前同样要求 `review_status=approved` 和冻结 Baseline。可用 `PPTXGENJS_MODULE` 指向隔离安装的 `pptxgenjs`，避免污染主项目。`package.json` 固定 `pptxgenjs@4.0.1`，并通过 `image-size@2.0.3` override 处理上游高危审计项；该组合已做真实 PPTX 写入验证。需要更高质量插画和版式时，仍优先使用完整设计 Skill，并保留 outline、渲染图和视觉检查记录。

## 版本与增量

所有模型和成果记录 `version`。人工修改 REQ 后，根据 ChangeSet 判断：

| 变化 | 必须复核的成果 |
| --- | --- |
| 核心流程、角色、权限、接口 | 技术设计、时序图、原型、PRD、PPT 简报 |
| 验收或页面行为 | PRD、原型、测试场景，必要时技术设计 |
| 范围、优先级、依赖 | PRD、排期、PPT 简报 |
| 仅排期负责人或日期 | 排期和汇报摘要 |
| 仅视觉方向 | 原型或 deck 视觉成果，不改 REQ 事实 |

未批准的新版本不能覆盖已发布成果。manifest 只登记本次实际存在的文件和真实状态。
