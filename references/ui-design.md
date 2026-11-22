# 内置 UI 规范 v1.0

## 统一生成入口

新用户安装 Skill 后，内部工作台使用 `assets/workbench-template.html`、`assets/workbench.css` 和 `assets/workbench.js`，由 `scripts/render_artifacts.py` 从 Project Data 渲染。工作台与交互原型的 HTML 壳均源自 `feat/workflow-execution@0488753`（`__WORKBENCH_STYLE__/__WORKBENCH_DATA__/__WORKBENCH_SCRIPT__` 与 `__PROTOTYPE_STYLE__/__PROTOTYPE_DATA__` 占位符、可折叠侧栏、页面导航和数据驱动渲染），仅替换数据层与交互逻辑以适配当前 Source／Evidence／REQ／Baseline／ChangeSet，不引入分支的后台服务。工作台包含可折叠侧栏、项目指标、证据卡、可勾选修订的 REQ 卡、技术设计、排期、PPT、评审复核包和 Agent 提示词弹层。甘特图使用 `assets/schedule-template.html` 与 `assets/ui.css`。

```bash
python scripts/render_artifacts.py --project <项目目录>
# 已有人工确认 Baseline 时，才允许附加 --prototype
# 只更新选定产物，避免重写无关文件
python scripts/render_artifacts.py --project <项目目录> --only prd,workbench,prototype --prototype
```

渲染器将工作台 CSS 和 JS 内联到独立 HTML，同时保留 `workbench/ui.css`。不得引入在线字体、CDN 或外部 UI 框架。旧版 `{{TOKEN}}` 静态模板和绕过预检的遗留渲染入口已删除，`render_project` 是唯一写入路径。原型使用 `assets/prototype-template.html` 的通用 `pages／fields／actions／records` 模型；`query.match_rule` 支持 `contains` 和 `exact`，`row_actions` 支持详情导航与 `archive` 二次确认。新项目优先定义 `prototype_pages`，旧 `prototype_flow` 自动转换。

## 设计依据

本规范供主 Skill 生成客户原型和内部工作台时使用，基础样式位于 ../assets/ui.css。视觉参考 ParTrace Vision 的 workbench 工作台中的侧栏、内容区和预览结构，具体页面围绕当前客户的任务与数据组织。

对应参考件位于 `feat/workflow-execution` 分支的 `docs/references/partrace-workbench/`；本包只采用其 HTML 壳与内置设计系统，不打包视频、PPT 或用户机器上的绝对路径。

## 确认设计依据

读取已确认 PRD、页面任务、用户角色与目标设备。核对客户已有品牌、设计系统与历史页面，记录适用的样式来源。需要类似产品参考时记录具体交互模式及出处。将 product_type、target_devices、existing_style_sources、reference_products、design_system_version 和 design_decisions 存入 project.json 的 design_context。

使用本规范作为默认设计系统，客户明确的样式约束作为项目级变量覆盖。覆盖后重新检查可读性和组件状态。已有数据中的 selected_ui_skills 保留为历史生成信息，新版本记录内置规范版本。

## 视觉与布局

- 字体默认 Inter，中文使用 PingFang SC、Microsoft YaHei 和系统无衬线回退。正文 15px，行高 1.6，辅助文字 13px，页面标题 28px。
- 浅灰蓝页面、白色内容卡、深色侧栏、蓝色主操作，成功、待确认和错误采用各自语义色。颜色同时配文字或图标反馈。
- 间距使用 4、8、12、16、24、32、48px。正文内容按任务分组，卡片圆角 12px，边框清晰。每个操作区突出一个主要动作。
- 桌面工作台采用 224px 侧栏与弹性内容区，内容默认最大宽度 1440px。生成的 ERD、架构图和原型通过独立页面入口或预览区打开。
- 窄于 900px 时收起侧栏为可访问导航。表格在自身容器内横向滚动，表单和内容卡改为单列，触控目标至少 44px。

## 按产品类型组织

| 产品类型 | 页面结构 |
| --- | --- |
| 内部业务系统 | 侧栏、页面标题与操作区、筛选、列表、详情 |
| 审批与操作流程 | 步骤、当前任务、表单、校验、确认与结果 |
| 数据分析工具 | 指标口径、筛选、图表、明细与数据来源 |
| 移动端服务 | 移动导航、核心任务、单列表单与操作结果 |
| 客户展示原型 | 围绕已确认主流程组织入口、关键操作与结果反馈 |

内部工作台固定为七个模块：项目总览、会议素材、功能模块、方案文档、原型、技术设计、评审记录。业务模型归入技术设计，排期归入项目总览／方案文档，PPT 是交付操作而非第八个模块。首屏呈现目标、范围、成果入口与待确认问题；只有实际产出时启用文件入口。

## 卡片内容与文案

卡片以标题、真实内容、状态和可执行操作组织信息。标题下的 description 仅在帮助用户作出判断或完成操作时出现。

- 功能入口直接使用功能名称与操作，列表卡展示实际记录，成果卡提供文件、版本或预览，评审卡展示具体问题与确认操作。
- 标题已表达含义时，移除重复解释。表格、字段、图示或操作已能说明功能时直接呈现内容。
- 保留必要的错误原因、输入约束、待确认状态、示例数据提示和来源信息。较长业务背景放到按需展开的详情中。
- 生成后检查每段辅助说明是否增加独立信息，删除只复述标题或操作的句子。

## 组件与行为

- 按钮区分主操作、次操作和危险操作，包含默认、悬停、键盘聚焦、禁用和提交中状态。提交中阻止重复请求并展示结果。
- 输入项提供持久标签、必要提示和就近错误，提交后保留用户输入。使用原生控件和语义化 HTML。
- 列表与表格包含加载、空数据、无筛选结果、失败与重试状态。使用模拟数据时显示“示例数据”。
- 详情与弹层支持键盘操作、Escape 关闭、焦点进入和关闭后恢复。确认行为显示关联版本与范围。
- 原型任务关联 REQ ID，页面主流程、返回和关键异常可操作。实际生成能力与示例接口状态保持一致。
- 内部资料、图示与客户原型使用独立入口，发布包包含用户选定内容。

## 验证

在桌面与 390px 宽度检查布局，确认中文换行、缩放、长字段、局部表格滚动及导航可用。键盘遍历主流程，检查可见焦点、弹层和表单错误反馈。普通文本对比度至少 4.5:1，大文本至少 3:1。记录实际浏览器检查结果和未通过项。
