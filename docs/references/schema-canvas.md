# Schema Canvas 参考

来源为用户自有的 schema-canvas Skill（用户于 2026-11-15 确认拥有其内容），已公开在 [SUertee/schema-canvas](https://github.com/SUertee/schema-canvas)，当前工程固定提交 `26233b6ff6273c86f28e11f49aaced9dadb4eb01`，入口为仓库根目录的 SKILL.md。来源、提交与环境变量在 [integrations.json](../../product-requirements/integrations.json) 维护。许可证为 MIT。

## 参考与接入范围

- 从业务实体、字段、关系与来源构建交互式 ERD。
- 保留表与字段搜索、关系聚焦和详细定义展示。
- 区分候选业务模型、逻辑关系与依据实际数据库定义的外键。
- 在主工作台提供独立的数据模型入口，关联项目版本与 REQ ID。

## 本地入口

```bash
python3 product-requirements/scripts/generate_artifacts.py --locate schema-canvas
```

配置 SCHEMA_CANVAS_SKILL_DIR 可选择其他安装位置。本地找不到时按 [按需下载](../../product-requirements/references/execution.md#缺少依赖时按需下载) 下载固定提交。主 Skill 的统一数据与文件约定见 [输出合同](../../product-requirements/references/project-data.md)。


## 在本项目中的采用位置

| 参考能力 | 本项目位置 | 采用状态 |
| --- | --- | --- |
| 从权威模型提取实体、字段与关系 | M03、project.json 的 business_model | 已定义合同 |
| 表搜索、关系聚焦和字段详情 | M06 的 data-model/index.html | 待接入生成 |
| 语义化关系与模型依据 | 输出合同、M07 的业务模型入口 | 已定义展示要求 |

本地来源包含 SKILL.md、references/design-system.md、references/interaction-contract.md 与 assets/reference-erd.html。修改前读取相关实现，示例实体与业务内容按当前项目数据替换。


## 来源快照

2026-11-25 公开仓库提交 `26233b6f`（首个提交加 MIT LICENSE）与本地开发副本比对：assets/reference-erd.html、references/design-system.md、references/interaction-contract.md 一致；仓库另增 README.md、LICENSE 与 references/schema-governance.md，SKILL.md 有更新。生成器只读取 assets/reference-erd.html。
