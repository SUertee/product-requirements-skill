# 产品需求落地 Skill 文档

团队从产品范围、设计与整体架构开始阅读，再按模块契约和实施路线开发。文档中的候选接口与验收标准标明设计状态，实际能力以源码及验证记录为准。

| 目录或文档 | 回答的问题 | 入口 |
| --- | --- | --- |
| PRODUCT.md | 为谁做、解决什么问题、交付什么 | [产品定义](PRODUCT.md) |
| design/ | 工作台与原型怎样组织和交互 | [工作台设计](design/workbench.md) |
| architecture/ | 模块、数据、任务和版本怎样协作 | [整体框架](architecture/README.md)、[模块拆分](architecture/modules.md)、[数据契约](architecture/contracts.md) |
| progress/ | 三人如何交接、先做什么、怎样验收 | [开发分工与进度](progress/development.md) |
| features/ | 当前实际可运行的功能与限制 | [实际功能](features/README.md) |
| references/ | 参考来源、固定版本和采用范围 | [参考索引](references/README.md) |

## 维护方式

- 产品规则在 PRODUCT.md 和主 Skill 的需求流程中维护，UI 的有效规范统一在包内 references/ui-design.md。
- architecture 定义模块与交接数据，progress 记录开发顺序、阶段验收与实际进展，features 对照实际代码描述能力。
- 参考资料保留来源和采用位置，参考副本的示例业务数据按来源标明。
- 主 Skill 位于 product-requirements/，docs 中的工程文档按具体任务读取。
- 新功能只增加有实际内容的文档，更新时修复入口与相对链接。

本组织方式参考用户既有 ScreenDeck docs 的导航与事实口径、FinDesk docs 的产品／设计／架构／路线职责，以及 ParTrace Vision docs 的模块输入输出与交接表。它们提供文档组织参考，当前项目的有效规则以本仓库为准。
