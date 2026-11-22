# 评审与修订记录

## 第一轮

| 问题 | 级别 | 处理 | 验证 |
|---|---|---|---|
| 原 Source/Segment 概念混用 | P0 | 分离材料 ID、片段 ID，增加独立 Schema 和关系校验 | 标准化与项目测试通过 |
| 只有规范，无可执行成果链路 | P0 | 增加九步执行合同、渲染器、固定演示和评估 | 实际生成 v1.0/v1.1 完整项目 |
| 沙箱 NamedTemporaryFile 写入失败 | P1 | 改为显式 mkstemp/fdopen 关闭/os.replace，保留原子性 | CLI 与替换失败回归通过 |
| 重复需求被重复计数 | P1 | ChangeSet 汇总按 REQ 和 duplicate_of 去重 | 五类变更测试通过 |
| 原型误追溯 parked REQ | P1 | manifest 从当前 Baseline 取 confirmed REQ | 固定评估排除 REQ-004 |
| 原型业务操作过于泛化 | P1 | 增加名称/负责人筛选、详情、时间线、空态和返回 | 内容断言、JS 语法和 HTML 打开检查 |
| v1.1 覆盖后无法查看旧产物 | P1 | 增加 artifacts/versions 两套快照 | 评估 v1.0 仍无负责人筛选 |

结论：已发现问题均已修复，无剩余 P0/P1。

## 第二轮：独立运行问题修复与分支模板融合

| 问题 | 级别 | 处理 | 验证 |
|---|---|---|---|
| 人工 PRD 修改被无变化重渲染覆盖 | P0 | 新增 render-state、生成 hash 预检、逐文件覆盖批准和评审留痕；冲突时零写入 | `test_manual_edit_conflicts_before_any_write_and_approval_is_logged` 通过 |
| 固定影响列表与全量重写 | P1 | 按变化字段和真实模型生成 impact_analysis/render_keys；支持 `--only`，同内容跳过，快照默认不覆盖 | no-op、选择性排期和动态影响测试通过 |
| ChangeSet 同秒 ID 碰撞 | P1 | ID 改为旧基线+规范化差异内容哈希，项目校验检查重复 ID | 内容稳定/差异 ID 与重复拒绝测试通过 |
| cancelled 与 Schema 不一致 | P1 | Schema、渲染器、工作台和评估统一支持 cancelled | 状态 Schema 测试通过 |
| 原型写死 includes、通用性不足、归档无专用交互 | P1 | 采用分支通用页面模型，支持 prototype_pages、contains/exact、详情导航和归档确认/取消 | 12 项 Chrome CDP 交互检查通过，0 运行错误 |
| 工作台卡片误触发筛选、模板视觉不统一 | P2 | 使用 `feat/workflow-execution@0488753` HTML 壳并重写当前数据驱动的七模块导航，不引入后台服务 | CDP 加载与后续浏览器回归 |
| manifest full 文档误分类、角色重复、PPT 固定样例文案、中文说话人 | P2 | 修正类型映射、角色拆分去重、动态生成模式文案和中文标签解析 | 新增对应单元测试通过 |

结论：本轮目标 P0/P1 均已修复；ASR、外部图示、真实客户审批和第二种 Agent 仍按声明依赖外部条件。

## 第三轮：收尾复核、清理与打包

| 问题 | 级别 | 处理 | 验证 |
|---|---|---|---|
| 遗留 `_render_project_legacy_static`／`_render_project_branch_unsafe` 仍无条件写文件，可绕过人工修改预检；且引用已删除的 `{{TOKEN}}` 模板 | P0 | 删除两个遗留渲染入口及仅服务于它们的 HTML helper、`render_delivery_artifacts` 与 `atomic_write_text` 依赖，`render_project` 成为唯一写入路径 | 新增静态断言 + 50 项测试全通过 |
| ChangeSet ID 虽改为内容哈希，但差异记录内嵌的 `created_at`／`updated_at` 使同一语义差异每次运行 ID 不同 | P1 | 身份计算递归剔除易变元数据，保留旧基线与全部语义字段 | 新增时间戳无关性测试；两个独立完整演示均得 `CHANGE-826f19876ddf738c204b` |
| 仓库自带 `examples/output/demo` 与当前渲染器不同步（v1.0 工作台快照仍是旧内容） | P1 | 全新目录重跑后原位同步 47 个生成文件，不删除、不改写历史快照语义 | Evidence／Project／manifest 三项校验通过 |
| 无打包产物与打包脚本，安装内容边界不清 | P1 | 新增 `scripts/package_skill.py`：固定时间戳、单根目录、逐文件 SHA-256 清单，排除运行目录／缓存／生成物；产出 `dist/product-requirements-skill.zip` | 新增包自检测试：两次构建字节一致、无垃圾文件、解压后 CLI／完整演示／评估真实通过 |
| 旧 `{{TOKEN}}` 模板、`proposal-template.md`、`requirement-card-template.md` 已无调用方 | P2 | 删除；`.gitignore` 移除私人录音文件名，补充通用媒体与缓存忽略 | 全仓库引用检索为空，git diff 检查通过 |
| 文档仍停留在第一轮数字（16 项测试、31 个文件）和未做浏览器回归的结论 | P2 | 重写 VALIDATION_REPORT、更新 CURRENT_STATE／DEMO_GUIDE／DATA_MODEL／README／UI 规范与输出合同，明确两处分支 HTML 壳来源 | 文档命令、链接与当前实现一致 |
| 原型 CDP 回归依赖 `runs/setup-generic-browser.py`（被 gitignore），干净检出无法复现；固定演示默认 `contains` 且无归档，导致检查直接抛 null | P1 | 新增受版本管理的 `tests/browser/setup_generic_prototype.py`，从固定演示复制并配置 `exact` + 归档，只重渲原型；补充单元断言与两步命令文档 | 本轮 Chrome 158 / CDP 9333：原型 12/12 通过、工作台 16/16 通过，均 0 运行时错误；工作台下载落盘受 Chrome 限制已记为 limitation |

结论：四项用户指定问题均已修复并有回归；清理、打包、文档同步完成。本轮真实执行了工作台与原型浏览器回归，不再依赖上一轮的历史结论。

## 保留限制

- 原始两份产品设计文档未在仓库中，未推测其内容。
- 目标比赛平台当届发布细则、真实宿主安装和真实 Agent 会议执行需另行验证。
- 真实 ASR、硬件、外部图示 Skill 和客户发布未执行。
- 第二轮与第三轮均执行过 Chrome CDP 真实浏览器回归；第三轮工作台 16 项、原型 12 项，0 运行时错误，工作台下载落盘限制已如实记录。其他浏览器、目标比赛平台和第二种 Agent 仍未验证。
