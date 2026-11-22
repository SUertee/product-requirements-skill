# 验证报告

验证日期：2026-11-22（第三轮收尾复核）。环境：Windows、Python 3.13.14、Node.js v22.22.2；项目脚本仅使用 Python 标准库，可选 PPTX 导出使用本地 PptxGenJS。

| 检查 | 实际命令/方式 | 结果 |
|---|---|---|
| 单元与集成测试 | `python -m unittest discover -s tests -q` | 51/51 通过（含增量安全、内容 ID、通用原型、分支 HTML 壳、安装包自检、浏览器夹具可复现） |
| 固定评估 | `python scripts/run_evals.py` | 12 个案例定义通过；全新临时端到端演示断言通过 |
| Evidence 关系 | `python scripts/validate_evidence.py --project examples/output/demo` | `status=passed`，errors 为空；负例覆盖伪原话、假 Segment、推断冒称 E1 |
| Project 关系 | `python scripts/validate_project.py --project examples/output/demo` | `status=passed`，errors 为空 |
| 完整演示 | `python scripts/run_demo.py --output <新目录>` | 成功；47 个文件，含两个 Baseline、ChangeSet、v1.0/v1.1 版本快照 |
| manifest | `python scripts/generate_manifest.py --project examples/output/demo` | 46 个输入文件登记（manifest 自身除外），12 个当前 Artifact；原型只含 confirmed REQ |
| ChangeSet ID 稳定性 | 两个独立临时目录各跑一次完整演示 | 均为 `CHANGE-826f19876ddf738c204b`；不同基线/不同改动得到不同 ID |
| JavaScript | 提取实际生成内联脚本与 `export_deck_pptx.mjs` 执行 `node --check` | 通过（单元测试覆盖） |
| HTML 壳 | 断言 `assets/workbench-template.html` 保留分支占位符与 DOM 且生成页无未替换 token | 通过 |
| 安装包 | `python scripts/package_skill.py` | 字节可复现；解压后 CLI `--help`、完整演示、`run_evals.py` 均通过（单元测试覆盖） |
| 工作台浏览器回归 | `node tests/browser/workbench_check.mjs examples/output/demo/artifacts/workbench/index.html` | Chrome 158 / CDP 9333：16 项检查全通过，0 运行时错误；`passed_with_limitations`（Chrome 在本环境取消最终下载落盘，复核包内容已从下载事件校验） |
| 原型浏览器回归 | `setup_generic_prototype.py` + `node tests/browser/generic_prototype_check.mjs` | Chrome 158 / CDP 9333：12 项检查全通过，0 运行时错误；覆盖 exact 查询、空态、负责人筛选、详情时间线、归档确认/取消 |
| Skill 静态校验 | skill-authoring `validate_skill.py`（第一轮） | 0 FAIL；目录和相对链接类 WARNING 已评审 |

## 负向验证

- 非法时间、空文件、不支持格式失败；原子替换失败保留旧文件。
- 重复输入哈希和稳定 ID 一致；新增、修改、取消、冲突、重复五类差异均有测试。
- 整条和字段级锁定均阻断对应自动修改；无批准 Baseline 时原型生成失败。
- 人工修改 Artifact 后，渲染在任何写入前抛 `ManualArtifactConflict`；零写入并保留未修改文件的 mtime；逐个批准才覆盖并留痕。
- 相同内容不重写；`--only` 选择性渲染不触及无关文档；同版本快照不被覆盖。
- 生成时间字段变化不改变 ChangeSet ID；重复 ChangeSet ID 被项目校验拒绝。
- 原型 `page_id` 重复、导航目标不存在时构造失败；`contains`／`exact`、详情导航和归档二次确认有静态与浏览器断言。
- 渲染模块无第二套绕过预检的写入路径（`atomic_write_text` 与遗留渲染入口已清除）。
- 已有演示目录未显式 `--force` 时拒绝重建；安装包不含缓存、运行目录、生成物或 `.git`。

## 未验证/不能声称

- 未执行真实客户会议 Agent 端到端评估；固定夹具不能替代这一证据。
- 本轮以 Chrome 158 / CDP 9333 真实执行工作台与原型交互回归；工作台复核包下载受 Chrome 落盘限制，已记录为 limitation，不声称文件成功写入磁盘。其他浏览器、目标比赛平台和第二种 Agent 未验证。
- 未验证真实 ASR、Archify/Schema Canvas 实际调用、外部图示 Skill、真实客户发布和目标平台安装。
- 第三方项目测试未在本环境运行；仅完成其源码和许可证审计。
