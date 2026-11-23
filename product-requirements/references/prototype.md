# 原型设计与生成

原型从项目定位、已确认的功能需求（FR）和非功能需求（NFR）出发，由主 Skill 设计页面并写出页面内容，脚本校验覆盖关系后装进统一外壳。只有表单和列表的简单业务可以继续使用 `pages` 的字段／操作定义，见 [运行流程](execution.md)。

## 前置条件

- 原型涉及的需求已人工确认，并有行为和验收标准。
- NFR 已整理并确认。原型能体现的写明体现方式，体现不了的写明原因。
- 生成脚本逐项检查以上条件，不满足时生成失败并说明缺少什么，不输出半成品。

## 设计步骤

按顺序完成，结果写入 project.json 的 `nfrs` 和 `prototype_design`。

1. **项目定位**：从需求画像和 design_context 判断产品类型、主要角色、目标设备和一条核心主流程。产品类型的页面结构参照 [内置 UI 规范](ui-design.md)。
2. **整理 NFR**：从原话中识别性能与数据量、权限与安全、兼容与设备、可靠性与失败处理、易用性、无障碍、审计与合规等约束。每条保留原话依据和证据类型，模型推断的标为 inferred，初始为 draft，等待人工确认。
3. **信息架构**：确定导航、页面清单、各角色可见的页面，以及每条已确认 FR 落在哪个页面。不需要界面的需求写入 `excluded_requirements` 并说明原因。
4. **页面设计**：每页写目的、关联 FR／NFR、需要演示的状态（空数据、加载中、出错、无权限、成功），再写页面内容和交互脚本。
5. **示例数据**：按业务数据模型准备足够演示分页、筛选和角色差异的示例记录，标明为示例。

## NFR 在原型中的体现

原型不连接真实服务，NFR 转成看得见的设计：

| 类别 | 体现方式 |
| --- | --- |
| performance 性能与数据量 | 分页与总数、加载中状态、查询反馈 |
| security 权限与安全 | 角色切换、按角色过滤数据和页面、无权限状态、敏感字段脱敏 |
| compatibility 兼容与设备 | 目标设备写入 positioning.target_devices，工作台按设备尺寸预览 |
| reliability 可靠性与失败处理 | 失败原因、保留已填内容、重试 |
| compliance 审计与合规 | 操作记录、二次确认 |
| accessibility 无障碍 | 标签、键盘可达、焦点与对比度 |

在页面元素上体现的 NFR 放进该页 `nfr_ids`；由整体外壳体现的（设备、角色切换）放进 `positioning.nfr_ids`。服务端吞吐、真实加密等原型无法体现的，`prototype_treatment.kind` 写 `not_applicable` 并说明在哪个阶段验证。

## 数据结构

`nfrs` 每项：`nfr_id`（NFR-001 起）、`category`、`title`、`statement`、`source_refs`、`evidence_type`、`review_status`，可选 `requirement_ids` 和 `prototype_treatment`（`kind` 为 shown 或 not_applicable，`note` 写具体做法或原因）。

`prototype_design`：

| 字段 | 内容 |
| --- | --- |
| positioning | product_type、target_devices（desktop／tablet／mobile）、main_flow，可选 nfr_ids |
| roles | 可选，role_id（小写字母、数字、连字符）与 name。多于一个角色时原型显示角色切换 |
| start_page_id | 默认打开的页面 |
| sample_data | 示例数据，页面脚本通过 `P.data` 读写 |
| excluded_requirements | 不在原型中的已确认需求及原因 |
| pages | 见下表 |

页面字段：`page_id`、`name`、`purpose`、`requirement_ids`、`nfr_ids`、`states`、`markup`，可选 `roles`（可访问的角色）、`nav`（false 表示不进导航，如详情页）、`script`、`css`。

## 页面内容约定

- `markup` 是页面主体 HTML，使用 assets/ui.css 的 `ui-card`、`ui-field`、`ui-button primary`、`ui-actions`、`ui-table-scroll`、`ui-stack`、`ui-title` 等类。不写 script、iframe、外部链接与资源、内联事件。
- 在实现某条 FR 的元素上写 `data-req="REQ-001"`，体现 NFR 的元素上写 `data-nfr="NFR-001"`，多个编号用空格分隔。页面声明的编号都要标在元素上，未声明的编号不能出现。工作台用这些标注做“标注需求”高亮。
- `data-goto="page_id"` 跳转页面，`data-param-id="T-1001"` 这类属性随跳转传参。`data-roles="agent,supervisor"` 限定元素对哪些角色可见。
- `data-state="error"` 的元素默认隐藏，`P.setState('error')` 或带 `data-show-state="error"` 的按钮显示它。页面声明的每个状态都要有对应元素。
- 表单提交已被外壳拦截，页面脚本自行监听 submit 并调用 `reportValidity()` 校验。
- `script` 以 `page`（本页根元素）和 `P` 为参数执行一次。`P` 提供 `h(tag, attrs, ...children)` 安全创建元素、`data`、`params`、`role`、`go(pageId, params)`、`onShow(pageId, fn)`、`onRole(fn)`、`setState(name)`、`loading(ms, then)`、`notify(text, kind)`。用户输入与示例数据用 textContent 或 `P.h` 输出。
- `css` 只写本项目需要的补充规则，类名加项目前缀，颜色、字号、圆角使用 ui.css 的 `--ui-*` 变量（见 [内置 UI 规范](ui-design.md)），不使用 url() 和 @import。

## 检查与生成

```bash
python3 product-requirements/scripts/prototype_design.py runs/.../project.json
python3 product-requirements/scripts/workflow.py --workspace <workspace> generate --run-dir <已确认版本> --version <新版本> --kind prototype
```

第一条在写入版本前检查设计稿并输出覆盖报告；第二条生成 prototype/index.html，覆盖报告写入 generation.json。检查项包括 FR／NFR 确认状态、需求覆盖或排除原因、NFR 体现或不适用原因、标注、跳转、状态、角色和外部资源。脚本运行错误在页面内显示并记录到 `window.__prototypeErrors`，浏览器复核需另行完成。

## 复核

工作台“原型预览”按页面列出关联 FR 与 NFR，原型内跳转时对照同步切换；“标注需求”在原型上高亮对应元素；按目标设备切换预览尺寸；“不在原型中”列出排除的需求和不适用的 NFR。负责人逐页核对后在评审记录中给出结论。
