# 产品需求落地 Skill

从客户会议到 PRD、工作台与交互原型。服务 PM／FDE，结合录音、逐字稿和前情资料，保留需求依据并支持评审后的增量修订。

## 使用入口

将整个仓库目录作为 Skill 包加载，入口为 [SKILL.md](SKILL.md)。它面向 FDE、产品经理、售前解决方案工程师和企业项目负责人，把会议材料变成可回查证据的需求工程成果，而不是只生成会议纪要。

真实使用时，兼容 Agent 按九步工作流理解材料、维护文件型 Project Data，并在需求确认、Baseline、ChangeSet 和客户发布处等待人工决定。Python 脚本只负责确定性转换、校验、差异和渲染，不替代 Agent 的语义分析。

已提供可浏览的固定演示输出：

- [内部工作台](examples/output/demo/artifacts/workbench/index.html)
- [交互原型](examples/output/demo/artifacts/prototype/index.html)
- [PRD](examples/output/demo/artifacts/prd.md)
- [ChangeSet](examples/output/demo/changesets/changeset-v1.1.json)

重新生成到新目录：

```bash
python scripts/run_demo.py --output runs/demo
```

该演示使用固定语义词典和**模拟确认**，不是通用 LLM，也不是真实客户审批。真实会议处理通过 Agent 调用本 Skill 完成。

## 输入、处理与成果

- 文本：TXT、MD、SRT、VTT；保留 SHA-256、原文和时间/段落定位。
- 音频视频：MP3、M4A、WAV、AAC、MP4、MOV 只通过宿主已授权的转写能力处理；没有能力时请求逐字稿。
- 历史资料：需求、PRD、业务和技术文档；关联不明时列入待确认。
- 输出：Source、Segment、Evidence、REQ、业务模型、方案、PRD、内部 HTML 工作台、可复制/下载的项目执行 Agent 提示词、确认后的原型、Baseline、ChangeSet 和 manifest。
- 重跑：沿用稳定 ID，保护整条及字段级人工锁定；历史产物保存在 `artifacts/versions/`。

文件结构、Schema 和关联见 [数据模型](docs/DATA_MODEL.md)，每步输入、质量检查和失败恢复见 [九步执行合同](references/execution.md)。工作台统一使用内置 `assets/workbench-template.html` 与 `assets/ui.css`，通过 `scripts/render_artifacts.py` 生成；安装包已包含完整模板，无需另行下载 UI 资源。

## 质量校验

```bash
python -m unittest discover -s tests -t . -v
python scripts/run_evals.py
python scripts/validate_evidence.py --project examples/output/demo
python scripts/validate_project.py --project examples/output/demo
```

评估覆盖十类会议与变更场景，区分固定样例断言和真实 Agent 执行复核。浏览器不可用时只能报告静态检查，不能声称交互验证通过。

## 复用到其他项目

把本目录安装到兼容的 Skills 目录，对客户项目使用独立输出目录，不要把客户数据写进 Skill 安装包。提供一份会议材料和可选历史资料，明确项目名称与输出目录即可启动；后续提供新会议或反馈时指向同一项目目录。详细操作见 [演示指南](docs/DEMO_GUIDE.md)。

## 参考与适配

需求建模来自团队提供的 Skill 设计文档与方案讨论。工作台信息组织参考 ParTrace Vision 的 workbench 工作台。业务模型可适配用户的 schema-canvas Skill，仓库中保留环境缺少该 Skill 时的生成约定。

项目方案在星宫赛事目录维护。工程源码在本仓库维护。


## 能力接入

主 Skill 组织录音接入、需求转化、建模、方案与 PRD、人工确认、原型、工作台汇总和最终复核。图示与 ERD 按 [能力接入与设计路由](references/capabilities.md) 调用，原型和工作台采用 [内置 UI 规范](references/ui-design.md) 与 assets/ui.css，固定依赖见 integrations.json。外部依赖通过宿主安装或工程旁 skill-dependencies 提供。
