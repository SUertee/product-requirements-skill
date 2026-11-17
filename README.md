# 产品需求落地 Skill

从客户会议到 PRD、工作台与交互原型。服务 PM／FDE，结合录音、逐字稿和前情资料，保留需求依据并支持评审后的增量修订。

## 使用入口

Skill 的执行入口为 [SKILL.md](skills/product-requirements-skill/SKILL.md)，执行指南、模板和工具位于该包内的 references/、assets/ 和 scripts/。当前已编写工作流、需求建模约定、输出合同与 PRD 模板，文本标准化脚本可以运行。端到端生成效果需在比赛宿主中验证，ASR 适配器、后台监听、工作台模板和原型生成待团队实现。

```bash
python3 skills/product-requirements-skill/scripts/normalize_transcript.py --input /path/to/meeting.srt --project-id demo --output runs/demo/sources.jsonl
```

## 三人协作

具体成员姓名与 GitHub 账号待确认，按 [开发分工](docs/development.md) 对应职责。先统一来源片段、需求卡与输出合同，再并行实现采集、理解和生成模块。

## 参考与适配

需求建模来自团队提供的 Skill 设计文档与方案讨论。工作台信息组织参考 ParTrace Vision 的 workbench 工作台。业务模型可适配用户的 schema-canvas Skill，仓库中保留环境缺少该 Skill 时的生成约定。

项目方案在星宫赛事目录维护。工程源码在本仓库维护。

## 能力接入

主 Skill 组织录音接入、需求转化、建模、方案与 PRD、人工确认、原型、工作台汇总和最终复核。图示与 ERD 按 [能力接入与设计路由](skills/product-requirements-skill/references/capabilities.md) 调用，原型和工作台采用 [内置 UI 规范](skills/product-requirements-skill/references/ui-design.md) 与包内 assets/ui.css，固定依赖见包内 integrations.json。外部依赖通过宿主安装或工程旁 skill-dependencies 提供。

## 工作台样式参考副本

[打开可编辑的 workbench](docs/references/partrace-workbench/workbench.html)。该副本保留 ParTrace Vision 的示例内容，用于继续优化工作台布局和样式，所需本地资源随目录保存。

## 文件组织

```text
product-requirements-skill/
├── README.md
├── skills/
│   └── product-requirements-skill/
│       ├── SKILL.md
│       ├── integrations.json
│       ├── references/
│       ├── assets/
│       └── scripts/
└── docs/
    ├── development.md
    └── references/
        ├── README.md
        ├── archify.md
        ├── schema-canvas.md
        └── partrace-workbench/
```

安装或加载主 Skill 时选择 `skills/product-requirements-skill/`。开发分工见 docs/development.md，设计与实现参考见 [参考索引](docs/references/README.md)。本地生成结果使用仓库根目录的 runs/，录音使用 recordings/，两者按现有忽略规则管理。
