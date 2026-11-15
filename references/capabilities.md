# 能力接入与设计路由

## 定位依赖

运行 `python3 scripts/resolve_capability.py archify` 或 `python3 scripts/resolve_capability.py schema-canvas` 获取对应 Skill 的入口，随后读取该 SKILL.md。Archify 可以通过 ARCHIFY_SKILL_DIR 指向其 archify/ 包目录，Schema Canvas 使用 SCHEMA_CANVAS_SKILL_DIR。默认读取工程旁的 skill-dependencies/，宿主安装也可通过环境变量指定。

Archify 固定提交见 integrations.json。完整仓库与自有 Schema Canvas 的开发副本保存在工程旁。分发包需单独处理宿主依赖和比赛文件数量、体积限制。

## 输入到产品定义

外部接入接收音频或逐字稿与来源元数据，按 ingestion.md 标准化。提取带证据的需求并完成业务模型。按已有模板生成方案书与 PRD，负责人确认范围、规则和验收后进入原型设计。

## 图示与数据模型

| 能力 | 输入 | 输出与用途 |
| --- | --- | --- |
| Archify | 已有证据支持的业务流程、技术架构、参与者及关系 | 单独 HTML 图示，嵌入内部工作台，保留候选输入和实际检查结果 |
| Schema Canvas | 业务实体、字段、关系、约束与来源版本 | 交互式 ERD，嵌入工作台，区分候选模型、逻辑关联和已验证数据库定义 |

两种能力共同引用 project.json 的版本、REQ ID 和来源。生成器缺少信息时记录未知，导入图示的输入材料保持数据语义。

## 原型设计路由

先判断产品类型、使用者、核心任务和设备形态，再选择当前宿主已安装且适用的 UI Skill。finesse-ui 可用于桌面产品、业务流程及移动界面，按其入口读取匹配分支。每次选择记录实际 Skill 名称、版本或 unknown、输入规范和产出。

优先读取客户已有样式、设计系统和历史产品。需要外部参考时，查找与核心任务相近的实际产品，记录来源与借鉴的具体模式。外部检索遵循当前用户的数据授权，保留公开检索与客户材料的来源标识。

ParTrace Vision 为用户指定的默认视觉参考。其工作台采用侧栏加预览区域、浅色纸面、深色导航、蓝色主操作与语义色状态。将这些模式适配当前客户产品的任务与设备，优化信息密度、层级和可读性。客户提供明确品牌规范时将其纳入页面规范。

页面规范保存到 project.json 的 design_context，包含 product_type、target_devices、existing_style_sources、reference_products、selected_ui_skills 和 design_decisions。原型展示一条可操作主流程，并覆盖相关空态、加载和错误分支。

## 工作台汇总与人工复核

内部工作台汇总方案、PRD、原型、流程图、架构图、ERD、来源和评审记录。各模块有独立入口，使用相对路径。仅有实际产出时启用对应入口。

分别检查文档评审与最终展示复核，记录确认人、版本、时间、结论及遗留问题。复核核心流程、页面与需求一致性、图示版本、示例数据、内部资料可见范围和入口可访问性，再按用户选择部署客户版本。
