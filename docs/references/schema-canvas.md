# Schema Canvas 参考

来源为用户自有的 schema-canvas Skill，用户于 2026-11-15 确认拥有其内容。工程旁 skill-dependencies/schema-canvas/ 保存开发副本，来源目录为用户本机的 .codex/skills/schema-canvas/。当前来源未提供独立版本号，修改时记录实际文件变化和验证结果。

## 参考与接入范围

- 从业务实体、字段、关系与来源构建交互式 ERD。
- 保留表与字段搜索、关系聚焦和详细定义展示。
- 区分候选业务模型、逻辑关系与依据实际数据库定义的外键。
- 在主工作台提供独立的数据模型入口，关联项目版本与 REQ ID。

## 本地入口

```bash
python3 product-requirements/scripts/resolve_capability.py schema-canvas
```

配置 SCHEMA_CANVAS_SKILL_DIR 可选择其他安装位置。主 Skill 的统一数据与文件约定见 [输出合同](../../product-requirements/references/output-contract.md)。


## 在本项目中的采用位置

| 参考能力 | 本项目位置 | 采用状态 |
| --- | --- | --- |
| 从权威模型提取实体、字段与关系 | M03、project.json 的 business_model | 已定义合同 |
| 表搜索、关系聚焦和字段详情 | M06 的 data-model/index.html | 待接入生成 |
| 语义化关系与模型依据 | 输出合同、M07 的业务模型入口 | 已定义展示要求 |

本地来源包含 SKILL.md、references/design-system.md、references/interaction-contract.md 与 assets/reference-erd.html。修改前读取相关实现，示例实体与业务内容按当前项目数据替换。


## 来源快照

2026-11-17 核对本地开发副本，共 5 个文件。按相对路径排序，将每个相对路径、NUL、文件内容、NUL 依次输入 SHA-256，得到 `0488fce03187fffcc17112810a2c420831887d5779fdafc3008d714f22f1e76b`。该摘要用于识别当前采用的自有 Skill 内容。
