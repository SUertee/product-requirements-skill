# 产品需求落地 Skill

从客户会议到精简 PRD、七模块工作台、交互原型、技术设计、排期甘特图与 PPT 简报。服务 PM／FDE，结合录音、逐字稿和前情资料，保留需求依据并支持评审后的增量修订。

## 使用入口

将整个仓库目录作为 Skill 包加载，入口为 [SKILL.md](SKILL.md)。它面向 FDE、产品经理、售前解决方案工程师和企业项目负责人，把会议材料变成可回查证据的需求工程成果，而不是只生成会议纪要。

真实使用时，兼容 Agent 按九步工作流理解材料、维护文件型 Project Data，并在需求确认、Baseline、ChangeSet 和客户发布处等待人工决定。Python 脚本只负责确定性转换、校验、差异和渲染，不替代 Agent 的语义分析。

已提供可浏览的固定演示输出：

- [内部工作台](examples/output/demo/artifacts/workbench/index.html)
- [交互原型](examples/output/demo/artifacts/prototype/index.html)
- [PRD](examples/output/demo/artifacts/prd.md)
- [技术设计](examples/output/demo/artifacts/technical-design.md)
- [排期甘特图](examples/output/demo/artifacts/schedule/index.html)
- [PPT 内容简报（未导出 PPTX）](examples/output/demo/artifacts/deck-brief.md)
- [ChangeSet](examples/output/demo/changesets/changeset-v1.1.json)

以上链接指向源码仓库中的固定演示输出。安装包不含生成物，解压后运行 `run_demo.py` 即可生成同样的文件。

重新生成到新目录：

```bash
python scripts/run_demo.py --output runs/demo
```

该演示使用固定语义词典和**模拟确认**，不是通用 LLM，也不是真实客户审批。真实会议处理通过 Agent 调用本 Skill 完成。

## 输入、处理与成果

- 文本：TXT、MD、SRT、VTT；保留 SHA-256、原文和时间/段落定位。
- 音频视频：MP3、M4A、WAV、AAC、MP4、MOV 只通过宿主已授权的转写能力处理；没有能力时请求逐字稿。
- 历史资料：需求、PRD、业务和技术文档；关联不明时列入待确认。
- 输出：Source、Segment、Evidence、REQ、业务模型、精简方案与 PRD、七模块内部 HTML 工作台、可复制/下载的项目执行 Agent 提示词、确认后的原型、可选技术设计、只读排期甘特图、PPT 内容简报、Baseline、ChangeSet 和 manifest。
- 人工复核：工作台可勾选 REQ、填写意见并导出 `req_revision` 复核包；Agent 将其转为候选 ChangeSet，锁定未解除且未批准时不覆盖 Baseline。
- 重跑：沿用稳定 ID，保护整条及字段级人工锁定；历史产物保存在 `artifacts/versions/`。

文件结构、Schema 和关联见 [数据模型](docs/DATA_MODEL.md)，每步输入、质量检查和失败恢复见 [九步执行合同](references/execution.md)。工作台模板壳采用 `feat/workflow-execution@0488753`，由内置 `assets/workbench-template.html`、`assets/workbench.css`、`assets/workbench.js` 适配当前 Project Data；原型使用通用页面模型。安装包包含全部模板，无需另行下载 UI 资源。

## 实际导出 PPT

完整 `huashu-design` 可用时优先走其 deck 路由；内部链路也可使用本地 PptxGenJS 兜底。简报必须先经人工批准并关联 Baseline：

```bash
npm install
node scripts/export_deck_pptx.mjs --project <项目目录>
```

导出器生成可编辑 PPTX 和带逐页讲解提示的 HTML deck，并回写真实输出路径；未批准或未安装依赖时不会伪装导出成功。

## 质量校验

```bash
python -m unittest discover -s tests -t . -v
python scripts/run_evals.py
python scripts/validate_evidence.py --project examples/output/demo
python scripts/validate_project.py --project examples/output/demo
python scripts/package_skill.py
```

评估覆盖十二类会议、变更与原型安全场景，区分固定样例断言和真实 Agent 执行复核。单元测试包含增量渲染安全、内容 ID、通用原型、工作台 HTML 壳和安装包自检。浏览器不可用时只能报告静态检查，不能声称交互验证通过。

## 安全增量渲染

```bash
# 按 ChangeSet 的 render_keys 只更新受影响产物
python scripts/render_artifacts.py --project <项目目录> --only prd,workbench,prototype --prototype

# 当前 Artifact 被人工修改时，默认在任何写入前失败；逐文件审批后才能覆盖
python scripts/render_artifacts.py --project <项目目录> --only prd --approve-artifact artifacts/prd.md
```

`reviews/render-state.json` 保存生成 hash。相同内容不会重写，历史快照不会被同版本重渲染覆盖；批准覆盖会追加到 `reviews/review.json`。`diff_requirements.py` 同时生成动态 `impact_analysis` 和 `render_keys`；ChangeSet ID 由旧基线 ID 与剔除生成时间等易变字段后的规范化差异内容哈希确定，既避免同秒碰撞，也让同一语义差异可复现，项目校验会拒绝重复 ID。

原型支持 `prototype_pages` 通用页面、字段、动作和记录，查询规则支持 `contains`／`exact`，并支持详情导航和归档二次确认。已有 `prototype_flow` 会自动兼容转换。固定演示默认使用 `contains` 且不启用归档；浏览器回归需要先用仓库内脚本准备 `exact` + 归档样例（该脚本已纳入版本管理，不依赖 `runs/` 中的临时文件）。真实浏览器已接入时，在 CDP 端口 9333 运行：

```bash
PROTO=$(python tests/browser/setup_generic_prototype.py --output runs/generic-browser-project)
node tests/browser/generic_prototype_check.mjs "$PROTO"
node tests/browser/workbench_check.mjs examples/output/demo/artifacts/workbench/index.html
```

## 清理与打包

```bash
python scripts/package_skill.py                       # 默认输出 dist/product-requirements-skill.zip
python scripts/package_skill.py --output /path/x.zip   # 自定义输出
```

打包脚本使用固定时间戳和排序后的文件列表，生成字节可复现的 zip：根目录为 `product-requirements-skill/`，含 `PACKAGE_MANIFEST.json`（逐文件 SHA-256）。仅收录安装所需的 `SKILL.md`、assets、references、schemas、scripts、`integrations.json`、可选 PPT 导出依赖声明、第三方归属说明，以及让 `run_demo.py`／`run_evals.py` 在解压后仍可独立运行的最小夹具。`runs/`、`examples/output/`、`node_modules/`、缓存、测试和 `.git` 不进入安装包。单元测试会在临时目录解压该包并真实执行 CLI、完整演示和评估，验证它不是只有文件的空壳。

仓库内 `runs/`（本地运行产物）和 `node_modules/` 已被忽略，可按需自行删除，不影响提交与打包。浏览器回归脚本与 `examples/output/demo` 属于源码仓库的开发资产，不在安装包内。

## 复用到其他项目

把本目录安装到兼容的 Skills 目录，对客户项目使用独立输出目录，不要把客户数据写进 Skill 安装包。提供一份会议材料和可选历史资料，明确项目名称与输出目录即可启动；后续提供新会议或反馈时指向同一项目目录。详细操作见 [演示指南](docs/DEMO_GUIDE.md)。

## 参考与适配

需求建模来自团队提供的 Skill 设计文档与方案讨论。工作台信息组织参考 ParTrace Vision 的 workbench 工作台。业务模型可适配用户的 schema-canvas Skill，仓库中保留环境缺少该 Skill 时的生成约定。

项目方案在星宫赛事目录维护。工程源码在本仓库维护。


## 能力接入

主 Skill 组织录音接入、需求转化、质量检查、建模、精简方案与 PRD、人工确认、原型、技术设计、排期、PPT 简报、七模块工作台汇总和最终复核。图示、需求方法与 deck 按 [能力接入与设计路由](references/capabilities.md)、[需求质量](references/requirement-quality.md) 和 [技术交付](references/technical-delivery.md) 调用。原型、工作台和甘特图采用 [内置 UI 规范](references/ui-design.md) 与 `assets/ui.css`。固定依赖见 `integrations.json`，外部依赖通过宿主安装或工程旁 `skill-dependencies` 提供；解析器只定位，不自动下载或执行第三方代码。
