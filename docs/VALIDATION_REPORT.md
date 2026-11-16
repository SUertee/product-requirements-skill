# 验证报告

验证日期：2026-11-16。环境：Windows、Python 3.11.15、Node.js 24.18.0；全部项目脚本仅使用 Python 标准库。

| 检查 | 实际命令/方式 | 结果 |
|---|---|---|
| 单元与集成测试 | `python -m unittest discover -s tests -t . -v` | 16/16 通过 |
| 固定评估 | `python scripts/run_evals.py` | 10 个案例定义通过；全新临时端到端演示断言通过 |
| Evidence 关系 | `python scripts/validate_evidence.py --project examples/output/demo` | 通过；负例验证伪原话、假 Segment、推断冒称 E1 会失败 |
| Project 关系 | `python scripts/validate_project.py --project examples/output/demo` | `status=passed`，errors 为空 |
| 完整演示 | `python scripts/run_demo.py --force` | 成功；31 个文件，含两个 Baseline、ChangeSet 和两个版本快照 |
| 变更结果 | 检查 `changeset-v1.1.json` | REQ-002 一条 Modified，无冲突；模拟审批标记为 true |
| manifest | `generate_manifest.py` | 30 个输入文件登记（manifest 自身除外），6 个当前 Artifact；原型只含 confirmed REQ |
| JavaScript | 提取实际生成内联脚本，执行 `node --check` | 通过 |
| HTML 入口 | 浏览器打开工作台和原型 file URL | 两个入口均成功打开 |
| Skill 静态校验 | skill-authoring `validate_skill.py` | 0 FAIL；目录和相对链接类 WARNING 已评审 |

## 负向验证

- 非法时间、空文件、不支持格式失败。
- 原子替换失败保留旧文件。
- 重复输入哈希和稳定 ID 一致。
- 新增、修改、取消、冲突、重复五类差异均有测试。
- 整条和字段级锁定均阻断对应自动修改。
- 无批准 Baseline 时原型生成失败。
- 已有演示目录未显式 `--force` 时拒绝重建。

## 未验证/不能声称

- 未执行真实客户会议 Agent 端到端评估；固定夹具不能替代这一证据。
- 未执行完整浏览器自动交互回归；仅验证入口打开、内容断言和 JS 语法。
- 未验证真实 ASR、Anker、Archify/Schema Canvas 实际调用、外部发布和目标平台安装。
- 第三方项目测试未在本环境运行；仅完成其源码和许可证审计。
