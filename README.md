# 产品需求落地 Skill

**把一场客户会议，变成一份有据可查、经人确认的需求和一个能点的产品原型。**

面向 PM 和 FDE（一线交付工程师）。把会议录音、逐字稿或飞书妙记交给 Skill，它会整理出需求、方案、PRD 和一个本地工作台；团队在工作台里逐条确认后，再生成给客户看的交互原型。之后的会议和客户反馈会接着更新同一个项目，形成新版本。

## 解决什么问题

- **会后信息丢失**：需求散在聊天和记忆里，转述几次就走样。这里每条需求都挂着会议原话和时间，随时回查。
- **AI 整理不可信**：分不清哪些是客户说的、哪些是模型猜的。这里每条结论都标明来源：明确表达、模型推断或产品建议，关键结论必须由人确认。
- **从需求到原型太慢**：确认完的需求直接生成交互原型和开发提示词，不用再从头画图、写文档。
- **多轮会议对不上**：第二次会议关联到同一项目，对比前后变化；人工改过并锁定的内容不会被新分析覆盖。

## 你会得到什么

| 产物 | 说明 |
| --- | --- |
| 项目工作台 | 单个 HTML 文件，七页：总览、会议素材、功能需求、方案文档、原型预览、技术设计、评审记录。本地打开即可浏览，配合本地服务可在页面里评审和生成新版本 |
| 需求卡 | 每条需求有稳定编号（REQ-001）、行为、规则、验收标准、会议原话和确认状态；非功能需求（性能、权限、设备等）单独成组 |
| 方案与 PRD | 按内置模板生成，可在工作台里按章节编辑、下载和打印 |
| 技术设计 | 业务模块图、技术架构图（Archify）、交互式数据模型（Schema Canvas）、按模块分组的接口草案 |
| 交互原型 | 按已确认的需求设计页面，可点击、可填表，标注每个元素对应哪条需求；客户可以直接在原型上提意见 |
| 开发提示词 | 只包含已确认的需求和边界，复制给 Claude Code、Cursor 等编码工具 |
| 版本记录 | 每一版怎么来的：分析了哪次会议、应用了哪些评审结论、改了什么 |

## 快速开始

**1. 安装**

```bash
npx skills add SUertee/product-requirements-skill
```

也可以手动把 `product-requirements/` 目录复制到所用工具的 Skill 目录，例如 Claude Code 的 `~/.claude/skills/product-requirements`。

运行需要 `python3`（3.10 及以上，只用标准库）。可选：`lark-cli` 用于读取飞书妙记，`ffmpeg` 用于处理录音录屏。

**2. 在 Claude Code、码道等工具里直接说**

```text
用产品需求落地 Skill 整理这份会议：/path/to/客户会议.srt，项目叫「售后工单系统」
```

```text
把这条飞书妙记整理成需求和工作台：https://xxx.feishu.cn/minutes/xxxx
```

```text
第二次会议的逐字稿在 /path/to/第二次.srt，关联到「售后工单系统」并对比变化
```

**3. 打开工作台评审**

Skill 会给出工作台的地址。在「功能需求」里逐条点确认、需要修改或暂缓，然后生成新版本；条件齐了以后，在「原型预览」把生成指令交给 Skill 生成原型。

## 工作流程

```text
会议素材 → 整理需求与建模 → 方案、PRD、工作台 → 人工确认 → 交互原型 → 客户复核 → 下一版本
```

1. **接入素材**：逐字稿（SRT／TXT）、飞书妙记链接、本地录音录屏（提取音轨后交给已配置的转写服务）。
2. **整理与建模**：结合客户背景和已有需求，整理需求画像、业务模块、需求卡、验收标准、非功能需求、疑问和数据模型，每条都引用原话。
3. **生成文档和工作台**：方案、PRD、技术设计和工作台，集中列出待确认的问题。
4. **人工确认**：负责人在工作台逐条确认需求和非功能需求，或直接修改；确认结果生成新版本，不覆盖旧版本。
5. **生成原型**：按已确认的需求设计页面并检查覆盖关系，未确认的内容不会进原型。
6. **客户复核与修订**：客户在原型上提意见（飞书表单），后续会议和反馈回写到需求，形成下一版本。

## 设计原则

- **证据优先**：每条需求、决策和约束都关联会议原话或人工补充的来源。
- **事实与推断分开**：明确区分客户表达、模型推断、产品建议和待确认。
- **先草稿后确认**：关键结论由人确认，对外分享按用户授权进行。
- **增量修订**：每次变化生成新版本，保留旧版本和人工锁定的字段，并列出差异。

## 组合的 Skill

主 Skill 负责从会议到交付的流程，图示和数据模型交给两个专门的 Skill：

| Skill | 用在哪里 |
| --- | --- |
| [Archify](docs/references/archify.md) | 业务模块图、技术架构图、流程图 |
| [Schema Canvas](docs/references/schema-canvas.md) | 交互式数据模型：实体、字段、关系，可搜索和聚焦 |

两者通过宿主安装或环境变量提供，缺少时工作台退回内置的简易图示。来源、固定版本和许可证见上面两个链接，定位配置见 [integrations.json](product-requirements/integrations.json)。

## 当前状态

- **已实现**：素材接入（逐字稿、妙记链接、本地音视频）、需求分析任务、版本差异与锁定保护、就地评审、方案／PRD／七页工作台、Archify 图示、Schema Canvas 数据模型、设计型交互原型、原型意见表单、客户交付包、版本记录。
- **已验证**：Python 回归 120 项，工作台、原型、模块图、架构图 4 组页面检查；用一场真实小组会议（46 分钟、549 段原话）试跑了「导入 → 分析 → 确认 → 生成原型」，其中确认一步由脚本代办。
- **待验证**：码道宿主中的加载与自动调用、真实转写服务的质量与费用、公网部署。录屏目前只处理音轨，画面理解尚未开发。

详细行为见 [实际功能](docs/features/README.md)，进展见 [工程进度](docs/progress/implementation.md)。

## 手动运行

不经过 Agent 时，也可以直接用脚本，从仓库根目录执行：

```bash
# 导入一次会议素材
python3 product-requirements/scripts/ingest_material.py \
  --input /path/to/meeting.srt --project-id demo --workspace runs/demo/inbox

# 由已有的 project.json 和 sources.jsonl 生成文档与工作台
python3 product-requirements/scripts/build_documents.py \
  --project runs/input/project.json --sources runs/input/sources.jsonl --output runs/demo/v1

# 启动本地工作台（可评审、生成新版本）
python3 product-requirements/scripts/serve_workbench.py \
  --run-dir runs/demo/v1 --workspace runs/demo/inbox --port 8765
```

分析、评审、生成和客户包的完整命令见 [运行流程](product-requirements/references/execution.md)，飞书和音视频接入见 [本地运行说明](docs/features/intake.md)。

## 仓库结构

```text
product-requirements-skill/
├── product-requirements/   Skill 本体（安装时只需要这个目录）
│   ├── SKILL.md            入口：任务路由、流程和原则
│   ├── references/         执行、数据格式、原型和界面规范
│   ├── assets/             工作台和原型的模板与样式
│   └── scripts/            接入、生成、版本和本地服务
├── docs/                   产品、设计、架构、进展文档
├── tests/                  回归测试
└── tools/                  打包脚本（比赛提交用）
```

文档入口见 [docs 导航](docs/README.md)，参与开发请先读 [AGENTS.md](AGENTS.md)。`runs/` 和 `recordings/` 存放本地运行结果和录音，不进入 Git。
