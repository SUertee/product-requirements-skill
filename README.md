# 产品需求落地 Skill

从客户会议到 PRD、工作台与交互原型。服务 PM／FDE，结合录音、逐字稿和前情资料，保留需求依据并支持评审后的增量修订。

## 使用入口

将整个仓库目录作为 Skill 包加载，入口为 [SKILL.md](SKILL.md)。当前已编写工作流、需求建模约定、输出合同与 PRD 模板，文本标准化脚本可以运行。端到端生成效果需在比赛宿主中验证，ASR 适配器、后台监听、工作台模板和原型生成待团队实现。

```bash
python3 scripts/normalize_transcript.py --input /path/to/meeting.srt --project-id demo --output runs/demo/sources.jsonl
```

## 三人协作

具体成员姓名与 GitHub 账号待确认，按 [开发分工](docs/development.md) 对应职责。先统一来源片段、需求卡与输出合同，再并行实现采集、理解和生成模块。

## 参考与适配

需求建模来自团队提供的 Skill 设计文档与方案讨论。工作台信息组织参考 ParTrace Vision。业务模型可适配用户的 schema-canvas Skill，仓库中保留环境缺少该 Skill 时的生成约定。

Artify 的确切 Skill 链接与版本待确认，目前采用主入口、按需参考、输出模板和脚本的分层结构。拿到原始链接后再核对格式。

项目方案在星宫赛事目录维护。工程源码在本仓库维护。
