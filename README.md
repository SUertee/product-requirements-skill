# 产品需求落地 Skill

面向 PM／FDE，将客户会议录音、逐字稿和前情资料整理为带原话依据的需求，生成项目方案、PRD 和内部工作台，经人工确认后继续生成客户交互原型。

减少会后信息遗漏和转述偏差，让团队围绕同一份需求、来源和模型讨论，加快从客户沟通到产品落地的过程。

## 工作流程

**会议录制／上传音视频 → 妙记处理完成 → Connector 获取素材 → 需求分析与建模 → 方案、PRD 和工作台 → 人工确认 → 交互原型 → 复核与客户分享。**

1. **获取素材**。飞书会议开启云录制，或将已有录音、录屏及录音豆导出文件上传妙记。本地文件也可直接导入工作台。
2. **接入与预处理**。妙记产物就绪后，获取带时间定位的逐字稿及所需原件，保存来源并去重。本地音视频可提取音轨，再由已授权的 ASR 服务转写。
3. **分析与建模**。结合客户背景、历史项目和已有需求基线，整理八要素、业务模块、需求卡、原话依据、疑问与数据模型。
4. **内部评审**。生成项目方案、PRD 和工作台，供团队核对范围、规则及验收标准，集中记录评审意见。
5. **原型交付**。人工确认后生成交互原型，复核核心流程和客户可见内容，再按授权部署分享。
6. **持续修订**。后续会议和客户反馈关联原需求，记录差异与影响，形成下一版本。

详细实施顺序、每页功能和完成条件见 [开发流程](docs/planning/development.md) 和 [功能 spec](docs/planning/functional-spec.md)。分析、评审、生成与客户包的命令见 [运行流程](product-requirements/references/execution.md)。

## 组合的 Skill

主 Skill 负责需求到交付的流程编排，结合 Archify 和 Schema Canvas 生成专业图示与数据模型页面。

| Skill | 职责 | 调用阶段与产物 |
| --- | --- | --- |
| 产品需求落地 Skill | 素材接入、需求理解、业务建模、文档生成、工作台汇总和评审修订 | 从来源片段整理需求，组织方案、PRD、工作台与原型交付 |
| Archify | 生成业务流程图、技术架构图等可独立打开的 HTML 图示 | 业务流程与架构关系明确后调用，产物进入工作台“技术设计 → 流程架构” |
| Schema Canvas（schema-canvas） | 展示实体、字段、关系与约束，提供搜索、关系聚焦和详情探索 | 业务模型整理后调用，交互式 ERD 进入工作台“技术设计 → 数据库” |

两种图示能力使用同一项目版本和需求依据。已实现业务流程和实体模型的输入适配，并用本机固定依赖执行合成生成。工作台展示实际登记的成果，各项生成与浏览器复核状态分别记录。

Archify 的上游为 tt-a1i/archify，当前固定提交为 `e37848822238e3a61b12739185cdadd49843a620`，采用 Apache-2.0，具体文件和第三方组件的声明随上游保留。Schema Canvas 为团队自有 Skill。来源、版本及接入范围分别见 [Archify 说明](docs/references/archify.md)、[Schema Canvas 说明](docs/references/schema-canvas.md)，配置入口为 [integrations.json](product-requirements/integrations.json)。

### 依赖位置

实际 Skill 包位于 `product-requirements/`，入口为 [SKILL.md](product-requirements/SKILL.md)。Archify 和 Schema Canvas 通过宿主安装或工程旁的 `skill-dependencies/` 提供，也可指定包目录。

```bash
export ARCHIFY_SKILL_DIR="/path/to/archify/archify"
export SCHEMA_CANVAS_SKILL_DIR="/path/to/schema-canvas"
python3 product-requirements/scripts/resolve_capability.py archify
python3 product-requirements/scripts/resolve_capability.py schema-canvas
```

定位成功表示入口可读。执行生成时还需读取对应 Skill 的入口、准备实际输入并完成其检查。完整调用规则见 [能力接入](product-requirements/references/capabilities.md)。

## 工作台内容

| 页面 | 内容 |
| --- | --- |
| 总览 | 项目目标、范围、核心流程、成果入口与三项关键疑问 |
| 会议素材 | 会议重点、分页原话、前情资料、录音／录屏及需求回查 |
| 功能需求 | 业务模块、需求卡、规则、验收、证据与确认状态 |
| 方案文档 | 按内置方案／PRD 模板生成、章节点选、章节编辑、保存新版本、正文下载和打印／PDF 入口 |
| 原型预览 | 交互页面、设备预览与独立打开 |
| 技术设计 | 流程架构、数据库和 API 三类内容 |
| 评审记录 | 待确认问题、版本绑定的意见、结论和导出 |

默认视觉参考用户已有的 ParTrace Vision workbench。工作台和原型使用包内 UI 规范及模板，卡片通过实际内容、状态和操作表达用途。有效规范见 [页面设计](product-requirements/references/workbench.md) 和 [UI 规范](product-requirements/references/ui-design.md)，原始样式参考见 [可编辑副本](docs/references/partrace-workbench/workbench.html)。

## 当前能力

- **已实现并做本地回归**。模块图／需求列表与关联详情、素材接收、妙记指定链接导入、来源标准化、分析任务、版本差异与锁定保护、评审应用、方案／PRD／七页工作台、Archify 流程图、Schema Canvas ERD、表单／列表原型和客户包。
- **已实现适配协议**。目录接收、显式妙记查询轮询、ASR 与分析宿主命令适配，提供去重、失败记录和重试。语义分析由配置的宿主执行，转写由配置的 ASR 执行。
- **实际验证**。88 项 Python 回归通过。合成端到端样例覆盖导入、评审、三个生成器、客户包和反馈版本。已导入 10 月 25 日天猫小组会议的 198 条来源片段并由当前助手分析。
- **待验证**。实际 ASR 质量、码道宿主加载与后台调用、公网部署。真实录制媒体下载被 lark-cli 的本地／内部地址校验拒绝，原录音比对待补充。

录屏当前处理音轨，画面理解待开发。多人在线编辑暂缓。当前行为与检查记录见 [实际功能](docs/features/README.md) 和 [工程进度](docs/progress/implementation.md)。

## 本地使用

本地工具使用 Python 标准库，已在 Python 3.11 环境验证。音轨提取使用 ffmpeg，飞书接入使用已授权的 lark-cli 用户身份。依赖、权限与命令见 [本地运行说明](docs/features/intake.md)。

### 比赛宿主

优先使用码道 IDE 联调本地脚本与工作台。官方活动指南同时提供码道 IDE 和 CodeArts 网页端创作、市场上传入口。当前实际 Skill 包名为 product-requirements，目录与 SKILL.md 的 name 已对齐。宿主加载和自动调用仍需实测。[官方活动指南](https://support.huaweicloud.com/offers-codeartsagent/codeartsagent_offers_0008.html)、[技能导入规范](https://support.huaweicloud.com/usermanual-codeartsagent/codeartsagent_ug_0024.html)

### 导入材料

```bash
python3 product-requirements/scripts/ingest_material.py \
  --input /path/to/meeting.mp4 \
  --project-id demo \
  --workspace runs/demo/inbox
```

接收器保存原件和任务记录。逐字稿生成来源片段后进入待分析状态，音视频等待可用转写。主 Skill 结合前情和基线整理结构化项目，字段约定见 [项目输入规范](product-requirements/references/project-data.md)。

### 生成与运行工作台

准备好 `project.json` 和 `sources.jsonl` 后，从仓库根目录执行。每次生成使用新的输出目录。

```bash
python3 product-requirements/scripts/build_documents.py \
  --project runs/input/project.json \
  --sources runs/input/sources.jsonl \
  --output runs/demo/v0.1

python3 product-requirements/scripts/serve_workbench.py \
  --run-dir runs/demo/v0.1 \
  --workspace runs/demo/inbox \
  --port 8765
```

打开命令返回的地址，即可浏览工作台、导入新材料和记录评审意见。静态工作台也可独立浏览，录音和其他附件随版本输出目录携带。新材料经 Skill 分析和修订后进入下一版本。

## 文件组织

```text
product-requirements-skill/
├── README.md
├── AGENTS.md                   开发与协作约定
├── product-requirements/       实际 Skill 包
│   ├── SKILL.md
│   ├── integrations.json       外部 Skill 来源和定位配置
│   ├── references/             执行、数据和页面规范
│   ├── assets/                 参与生成的模板与样式
│   └── scripts/                接收、生成及本地运行工具
├── docs/                       产品、设计、架构和开发文档
└── tests/                      数据、接入与本地接口回归测试
```

完整文档入口见 [docs 导航](docs/README.md)，开发约定见 [AGENTS.md](AGENTS.md)。`runs/` 保存本地运行结果，`recordings/` 保存本地录音，两者已加入 Git 忽略规则。项目方案在星宫赛事目录维护，工程源码和开发文档在本仓库维护。
