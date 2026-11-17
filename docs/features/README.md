# 当前实际功能

2026-11-17 按源码和本地检查记录的能力。端到端会议理解与成果生成仍需开发联调。

| 功能 | 实际行为 | 限制与验证 |
| --- | --- | --- |
| 文本与字幕标准化 | UTF-8 TXT、Markdown、SRT、VTT 转来源 JSONL，保留段落或时间定位 | 已检查字幕时间、重复运行 ID 稳定、普通文本和失败保留旧输出。音频转写适配器待实现 |
| 外部 Skill 定位 | 环境变量或默认开发依赖位置定位 Archify／Schema Canvas 入口 | 已验证本机两个入口，定位成功仅代表文件可读 |
| 结构化需求到文档 | 校验项目与来源，按模板生成方案／PRD、疑问及 manifest，保存原输入与锁定字段 | 已通过 9 项回归检查，覆盖引用、ID、项目归属、输出保护、写入失败与锁。会议自动理解待实现 |
| 内置 UI 规则 | 页面组织、语义色、组件状态、响应式及辅助文案规则，附基础 CSS | 尚需实际生成的客户项目页面验证 |
| 参考 workbench | 原示例可编辑 HTML 及相关页面、脚本、视频和演示稿 | 27 处本地 HTML 引用已检查，参考副本的业务内容属于 ParTrace Vision |

从仓库根目录运行文本标准化与定位工具。

```bash
python3 product-requirements/scripts/normalize_transcript.py --input meeting.txt --project-id demo --output runs/demo/sources.jsonl
python3 product-requirements/scripts/resolve_capability.py archify
python3 product-requirements/scripts/resolve_capability.py schema-canvas
```

Archify 开发副本的 doctor 检查已通过，当前项目输入适配、图示生成与工作台集成待联调。设计与实施顺序分别见 [整体架构](../architecture/README.md)和[开发计划](../planning/development.md)。


文档生成命令与字段见 [结构化项目输入](../../product-requirements/references/project-data.md)。
