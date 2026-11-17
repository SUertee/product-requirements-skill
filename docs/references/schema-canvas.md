# Schema Canvas 参考

来源为用户自有的 schema-canvas Skill，用户于 2026-11-15 确认拥有其内容。工程旁 skill-dependencies/schema-canvas/ 保存开发副本，来源目录为用户本机的 .codex/skills/schema-canvas/。当前来源未提供独立版本号，修改时记录实际文件变化和验证结果。

## 参考与接入范围

- 从业务实体、字段、关系与来源构建交互式 ERD。
- 保留表与字段搜索、关系聚焦和详细定义展示。
- 区分候选业务模型、逻辑关系与依据实际数据库定义的外键。
- 在主工作台提供独立的数据模型入口，关联项目版本与 REQ ID。

## 本地入口

```bash
python3 skills/product-requirements-skill/scripts/resolve_capability.py schema-canvas
```

配置 SCHEMA_CANVAS_SKILL_DIR 可选择其他安装位置。主 Skill 的统一数据与文件约定见 [输出合同](../../skills/product-requirements-skill/references/output-contract.md)。
