# 产品需求落地 Skill

从客户会议到 PRD、工作台与交互原型。服务 PM／FDE，结合录音、逐字稿和前情资料，保留需求依据并支持评审后的增量修订。

## 工作流程

目标链路为 **会议录制／上传音视频 → 妙记处理完成 → Connector 获取素材 → Skill 分析与建模 → 内部工作台 → 人工确认 → 交互原型 → 复核与客户分享**。

1. **获取素材**。飞书会议开启云录制，或将已有录音、录屏及录音豆导出文件上传妙记。本地文件也可直接导入工作台。
2. **接入与预处理**。妙记产物就绪后，通过 Connector 获取带时间定位的逐字稿及所需原件，保存来源并去重。本地音视频可提取音轨，交由已授权的 ASR 服务转写。
3. **分析与建模**。结合客户背景、历史项目和已有需求基线，整理八要素、业务模块、带原话依据的需求、疑问与数据模型。
4. **内部评审**。生成项目方案、PRD 和工作台，供团队核对范围、规则及验收标准，集中记录评审意见。
5. **原型交付**。人工确认后生成可交互原型，复核核心流程与客户可见内容，再按授权部署分享。
6. **持续修订**。后续会议和客户反馈关联原需求，记录差异与影响，形成下一版本。

当前已实现指定妙记链接获取、本地接收与预处理、结构化文档和工作台生成，以及评审意见保存。自动监听妙记、ASR、后台自动分析、自动原型生成与部署仍待接入。详细设计与完成条件见 [开发流程](docs/planning/development.md)。

## 使用入口

Skill 的执行入口为 [SKILL.md](product-requirements/SKILL.md)，执行指南、模板和工具位于该包内的 references/、assets/ 和 scripts/。当前已编写工作流、需求建模约定、输出合同与 PRD 模板，文本标准化脚本可以运行。端到端生成效果需在比赛宿主中验证，结构化需求可生成方案与 PRD 草稿。已增加七页内部工作台、本地文件接收、录屏音轨提取、飞书妙记指定链接 Connector 与评审意见存储。ASR、后台自动分析和原型生成待接入。

```bash
python3 product-requirements/scripts/normalize_transcript.py --input /path/to/meeting.srt --project-id demo --output runs/demo/sources.jsonl
```

## 开发文档

整体框架、模块职责、数据契约和实际能力见 [docs 导航](docs/README.md)。

文档生成命令与字段见 [项目输入规范](product-requirements/references/project-data.md)。

## 本地工作台

已生成文档版本后，通过 `product-requirements/scripts/serve_workbench.py --run-dir <版本目录> --workspace <接收箱目录>` 启动。支持导入录音、录屏与逐字稿、获取指定妙记，以及保存版本绑定的评审意见。具体命令与限制见 [本地运行说明](docs/features/intake.md)，整体顺序见 [开发流程](docs/planning/development.md)。

## 参考与适配

需求建模来自团队提供的 Skill 设计文档与方案讨论。工作台信息组织参考 ParTrace Vision 的 workbench 工作台。业务模型可适配用户的 schema-canvas Skill，仓库中保留环境缺少该 Skill 时的生成约定。

项目方案在星宫赛事目录维护。工程源码在本仓库维护。

## 能力接入

主 Skill 组织录音接入、需求转化、建模、方案与 PRD、人工确认、原型、工作台汇总和最终复核。图示与 ERD 按 [能力接入与设计路由](product-requirements/references/capabilities.md) 调用，原型采用 [内置 UI 规范](product-requirements/references/ui-design.md) 与 assets/ui.css，工作台采用 [页面规范](product-requirements/references/workbench.md) 与包内 assets/workbench-template.html、workbench.css、workbench.js，固定依赖见包内 integrations.json。外部依赖通过宿主安装或工程旁 skill-dependencies 提供。

## 工作台样式参考副本

[打开可编辑的 workbench](docs/references/partrace-workbench/workbench.html)。该副本保留 ParTrace Vision 的示例内容，用于继续优化工作台布局和样式，所需本地资源随目录保存。

## 文件组织

```text
product-requirements-skill/
├── README.md
├── product-requirements/
│   ├── SKILL.md
│   ├── integrations.json
│   ├── references/
│   ├── assets/
│   └── scripts/
└── docs/
    ├── README.md
    ├── PRODUCT.md
    ├── architecture/
    ├── design/
    ├── planning/
    ├── progress/
    ├── features/
    └── references/
        ├── README.md
        ├── archify.md
        ├── schema-canvas.md
        └── partrace-workbench/
```

安装或加载主 Skill 时选择 `product-requirements/`。开发计划见 docs/planning/development.md，设计与实现参考见 [参考索引](docs/references/README.md)。本地生成结果使用仓库根目录的 runs/，录音使用 recordings/，两者按现有忽略规则管理。


整体框架、模块交接与实施路线见 [项目文档导航](docs/README.md)。
