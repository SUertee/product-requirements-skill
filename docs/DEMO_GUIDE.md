# 现场演示指南

## 1. 演示边界

固定演示证明确定性脚本、数据关系、版本和产物能实际执行；其中语义提取来自 `tests/fixtures/demo_extraction.json`，评审由夹具明确标记为 `simulated_confirmation=true`。它不是通用模型调用，也不是真实客户批准。

真实比赛演示应另选一份已授权脱敏会议，由兼容 Agent 按 `SKILL.md` 执行，并在相应人工门禁暂停。不要把固定演示输出冒充真实会议分析。

## 2. 一键执行固定演示

```bash
python scripts/run_demo.py --output runs/demo
```

已有输出时脚本会停止；只有明确需要重建固定样例时才使用 `--force`，避免静默覆盖历史版本。`--force` 不会覆盖 `artifacts/versions/` 里的旧快照；需要刷新仓库自带的整套示例时，应在全新目录生成后把文件同步回 `examples/output/demo/`。

打开：

```text
runs/demo/artifacts/workbench/index.html
runs/demo/artifacts/prototype/index.html
runs/demo/artifacts/schedule/index.html
runs/demo/artifacts/technical-design.md
runs/demo/artifacts/deck-brief.md
```

仓库已包含实际生成的一套输出：`examples/output/demo/`。

## 3. 实际执行的链路

1. 读取 `examples/input/demo_meeting.srt` 和 `history.md`。
2. 标准化为独立 Source 和 Segment，保留原话和时间。
3. 固定样例提取 Evidence，包含新会议 E1、历史冲突 E0 和模糊表达 E0。
4. 生成 REQ-001～004、八要素、业务模型、方案和 PRD 草稿。
5. 运行 Evidence 和 Project 校验。
6. 通过显式标记的**模拟确认**冻结 v1.0，生成第一版原型。
7. 读取 `customer_feedback.md`，为 REQ-002 增加负责人筛选与空状态。
8. 生成 ChangeSet：1 条 Modified，展示旧值、新值、反馈 Evidence 和影响文件。
9. 模拟批准后生成 v1.1，保留 v1.0/v1.1 Baseline 和版本化 HTML/PRD 快照。
10. 写入候选技术设计、示例排期和 PPT 简报，实际渲染技术设计、甘特图和简报；候选 `.mmd` 不执行 draw.io 导出，简报不伪装成 PPTX。
11. 生成 manifest，只登记真实文件。

## 4. 原型操作

1. 输入“星澜”并查询，观察匹配客户。
2. 选择“销售 A”，观察组合筛选。
3. 输入不存在的名称，观察空状态。
4. 清除条件，点击“查看跟进记录”，进入跟进时间线。
5. 点击“返回客户列表”，确认筛选条件保留。
6. 点击“模拟接口失败”，确认明确提示未连接真实服务。

页面中的客户和跟进记录全部标记为示例数据，接口为模拟接口。

## 5. 质量演示

```bash
python -m unittest discover -s tests -t . -v
python scripts/run_evals.py
python scripts/validate_evidence.py --project runs/demo
python scripts/validate_project.py --project runs/demo
```

重点展示一条 REQ 如何从 `requirements.json` 找到 Evidence，再从 Evidence 找到 `transcript.jsonl` 的真实原话。

## 6. 真实 Agent 演示方式

对用户提供的材料调用 Skill，不由 `run_demo.py` 代替：

- Draft 完成后展示 REQ、冲突和待确认，等待用户确认。
- 用户确认后冻结 Baseline 并生成原型；无回复时停止。
- 反馈后只生成 ChangeSet，等待用户批准再更新版本。
- 客户发布需要另行选择和授权；本 Skill 不主动发布。

真实执行评估按 `evals/` 三份清单保存实际输出和检查结果，不能用固定样例的 PASS 代替。

## 7. 尚未验证项

- 目标比赛平台的最终安装与发布流程需按当届官网复核。
- 真实录音转写、Anker 硬件同步、外部图示 Skill、huashu-design 实际 PPTX 导出和真实客户发布未执行。
- 本轮已用 Chrome 158 / CDP 9333 执行工作台 16 项与原型 12 项真实交互检查，0 运行时错误；工作台复核包下载因 Chrome 取消落盘被标为 limitation。原型检查须先用 `tests/browser/setup_generic_prototype.py` 准备 `exact` + 归档样例。其他浏览器、目标比赛平台和第二种 Agent 未验证。
- 安装包由 `scripts/package_skill.py` 生成；单元测试会解压后在包外真实运行 CLI、完整演示和评估，这是可复现的自动检查。浏览器回归脚本与 `examples/output/demo` 属于源码仓库资产，不在安装包内。
