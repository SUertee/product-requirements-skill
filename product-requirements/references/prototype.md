# 原型设计与生成

原型建在「功能需求」和「方案文档」之上：从已确认的功能需求（FR）、非功能需求（NFR）和方案里的业务模块出发，按统一的设计规范设计页面，脚本校验覆盖关系后装进统一外壳。原型确认后，再以它为准整理技术设计（见文末）。只有表单和列表的简单业务可以继续使用 `pages` 的字段／操作定义，见 [运行流程](execution.md)。

## 前置条件

- 原型涉及的需求已人工确认，并有行为和验收标准。
- NFR 已整理并确认。原型能体现的写明体现方式，体现不了的写明原因。
- 方案里有业务模块（`modules`）时，模块已按需求分好。
- 生成脚本逐项检查以上条件，不满足时生成失败并说明缺少什么，不输出半成品。

## 设计步骤

分四段，按顺序完成，结果写入 project.json 的 `nfrs` 和 `prototype_design`。

**一、需求**
1. 核对要进原型的 FR 都已确认、有验收标准；整理 NFR：分析时已整理的先核对补全，没有的从原话中识别性能与数据量、权限与安全、兼容与设备、可靠性与失败处理、易用性、无障碍、审计与合规等约束。每条保留原话依据和证据类型，模型推断的标为 inferred，初始为 draft，等待人工确认。

**二、模块与信息架构**（依据方案文档）
2. 项目定位：定主要角色、目标设备和一条核心主流程，主流程取自方案里的业务流程。
3. 信息架构：按方案的业务模块组织导航，每个模块下列它的页面，每个页面写 `module_id`；页面承载的需求必须属于该模块（或不属于任何模块），跨模块的需求拆成两页。各角色可见的页面、每条已确认 FR 落在哪个页面也在这一步定。不需要界面的需求写入 `excluded_requirements` 并说明原因。工作台、看板形态的侧边导航会按模块分组显示。

**三、UI 规范**
4. 判断原型形态（见下节），再制定设计规范（见下节“设计规范”），经用户确认。形态决定外壳布局和页面写法，规范决定主色、字体、圆角、密度和卡片；所有形态共用 [内置 UI 规范](ui-design.md)。

**四、页面实现**
5. 页面设计：每页写目的、关联 FR／NFR、需要演示的状态（空数据、加载中、出错、无权限、成功），再写页面内容和交互脚本。只用 ui.css 的组件类和 `--ui-*` 变量，见“页面内容约定”。
6. 示例数据：按方案里的业务数据模型准备足够演示分页、筛选和角色差异的示例记录，标明为示例。

## 原型形态

一个原型只对应一种形态，写入 `positioning.archetype`。外壳按形态换骨架和导航；颜色、字号、圆角、按钮、表单、卡片、表格和状态在所有形态里一致，都用 assets/ui.css。

| 形态 | archetype | 适用 | 外壳 | 页面怎么写 | 默认设备 |
| --- | --- | --- | --- | --- | --- |
| 工作台／管理后台 | `workspace` | 内部业务系统、CRM、工单、审核后台 | 左侧深色导航 | 页面标题和主操作在上，筛选 + 列表（`ui-table-scroll`），点行进详情（`nav: false`）；批量和危险操作二次确认 | desktop |
| 数据看板 | `dashboard` | 经营分析、监控、报表 | 左侧导航，内容区更宽 | 顶部时间与维度筛选，`ui-grid` 放 `ui-stat` 指标卡（写口径），下面趋势与明细表，注明数据来源和更新时间 | desktop |
| 移动应用 | `mobile_app` | App、小程序、H5 服务 | 顶部标题栏 + 底部标签栏（3–5 个导航页） | 单列：`ui-list` 列表行、卡片、单列表单；主操作放在内容末尾，触控目标至少 44px；详情、编辑页不进标签栏 | mobile |
| 对话／聊天 | `chat` | 客服、AI 助手、社群、即时消息 | 顶部导航条 | 会话页用 `ui-chat`：`ui-messages` 里放 `ui-message`（自己的加 `mine`），底部 `ui-composer` 输入框；演示发送中、发送失败可重发、空会话；AI 回复标明来源或“生成中” | desktop、mobile |
| 网站／落地页 | `website` | 官网、产品介绍、活动页、内容站 | 顶部浅色导航条，内容最宽 1120px | 首屏 `ui-hero`（标题、一句话价值、主按钮），其后 `ui-section` 分段，表单留资；不放后台式表格 | desktop、mobile |
| 流程／表单 | `flow` | 报名、申请、审批发起、开户、下单 | 顶部导航条，内容最宽 760px | 每页一步，顶部 `ui-steps`（当前步 `aria-current="step"`），单列表单、就近校验，最后一步是确认与结果 | desktop、mobile |

判断方法：

- 从需求画像、角色、使用场景和会议原话判断。比如“客户在手机上下单”是 `mobile_app` 或 `flow`，“主管看每日数据”是 `dashboard`，“坐席回复客户消息”是 `chat`。
- 需求里没说清，或同时有多种端（例如用户端 App 和管理后台），设计前问用户一次：列出候选形态和各自依据，请用户选本期原型做哪一种。另一端在后续版本单独出原型。
- 无人值守运行时取最贴近核心主流程的形态，并在 `design_context` 记下理由，留给复核。
- 旧设计没有 `archetype` 时按 `workspace` 处理。

### 设计规范

每个原型有一份自己的设计规范，写在 `positioning.theme`，管主题色、字体、圆角、密度和卡片层次；字号阶梯、间距、组件写法和成功／警告／危险色仍是统一的内置规范，不随项目变化。

| 字段 | 取值 | 作用 |
| --- | --- | --- |
| source、style、keywords | 文字 | 规范从哪来（ui-ux-pro-max、brand、default）、风格名和关键词，供复核 |
| accent | `#RRGGBB` | 主色：按钮、链接、选中、焦点，并推出浅底、边框和深色导航底色 |
| page、surface、ink、muted、border | `#RRGGBB`，可选 | 页面底色、卡片底色、正文、次要文字、边框。只支持浅色，正文对卡片至少 7:1，次要文字对底色至少 4.5:1 |
| nav | light／dark | 导航深浅。缺省时工作台、看板用深色，其余用浅色 |
| font | sans／serif／rounded／mono | 字体气质，用系统字体实现，原型不加载网络字体。serif 只用于标题，正文仍是无衬线；rounded、mono 标题和正文一起用 |
| radius | sharp／default／round | 圆角：方正、适中、圆润 |
| density | compact／default／comfortable | 控件高度和卡片内距；移动应用不能用 compact（触控至少 44px） |
| elevation | flat／soft | 卡片平面或浅阴影 |

制定步骤：

1. 定好原型形态后（设计步骤 4），按 [按需下载](execution.md#缺少依赖时按需下载) 定位 UI/UX Pro Max。缺失时和其他依赖合在一次询问里；跳过则用内置默认规范，只按品牌色设 accent。
2. 用产品类型、行业和风格词查询，不写客户名称和项目内部信息：

   ```bash
   python3 "$UI_UX_PRO_MAX_SKILL_DIR/scripts/search.py" "<产品类型> <行业> <风格词>" --design-system --json > design-system.json
   python3 scripts/prototype_design.py --theme-from --archetype <形态> design-system.json
   ```

   第二条把推荐转成 `positioning.theme`：主色接近黑色时改用它的行动色；深色配色、网络字体、毛玻璃／黏土等特效和落地页版式不带入，只换算成上表的取值。
3. 客户资料里有品牌色时，用品牌色覆盖 accent，source 写 brand。
4. 把规范摘要（风格、主色和几种底色、字体、圆角、密度）发给用户确认或调整，再写入 project.json 生成原型。工作台“原型预览”的“设计规范”按钮可随时查看。
5. 生成后按 UI/UX Pro Max 给的交付前检查清单逐项核对（对比度、焦点、触控尺寸、窄屏、减少动效），未通过的项写进 `design_context.review_notes`。

亮色主色（橙、黄、浅绿）配白字对比度不够时，按钮文字改深色、保留品牌色；深色字也不够时才加深主色。覆盖报告的 `theme.notes` 记下这些调整。

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
| positioning | archetype（见原型形态）、product_type（具体业务说法）、target_devices（desktop／tablet／mobile）、main_flow，可选 theme（见设计规范）和 nfr_ids |
| roles | 可选，role_id（小写字母、数字、连字符）与 name。多于一个角色时原型显示角色切换 |
| start_page_id | 默认打开的页面 |
| sample_data | 示例数据，页面脚本通过 `P.data` 读写 |
| excluded_requirements | 不在原型中的已确认需求及原因 |
| feedback_form_url | 可选，客户意见表单的飞书多维表格分享链接，见 [外部接入](ingestion.md) |
| pages | 见下表 |

页面字段：`page_id`、`name`、`purpose`、`module_id`（方案有业务模块时必填）、`requirement_ids`、`nfr_ids`、`states`、`markup`，可选 `roles`（可访问的角色）、`nav`（false 表示不进导航，如详情页）、`script`、`css`。

## 页面内容约定

- `markup` 是页面主体 HTML，使用 assets/ui.css 的通用类：`ui-title`、`ui-card`、`ui-stack`、`ui-grid`、`ui-field`、`ui-button primary`、`ui-actions`、`ui-table-scroll`、`ui-list`、`ui-stat`、`ui-badge`，以及形态专用的 `ui-chat`／`ui-messages`／`ui-message`／`ui-composer`、`ui-hero`／`ui-section`、`ui-steps`。先用这些类，确实不够再写页面 css。不写 script、iframe、外部链接与资源、内联事件。
- 在实现某条 FR 的元素上写 `data-req="REQ-001"`，体现 NFR 的元素上写 `data-nfr="NFR-001"`，多个编号用空格分隔。页面声明的编号都要标在元素上，未声明的编号不能出现。工作台用这些标注做“标注需求”高亮。
- `data-goto="page_id"` 跳转页面，`data-param-id="T-1001"` 这类属性随跳转传参。`data-roles="agent,supervisor"` 限定元素对哪些角色可见。
- `data-state="error"` 的元素默认隐藏，`P.setState('error')` 或带 `data-show-state="error"` 的按钮显示它。页面声明的每个状态都要有对应元素。
- 表单提交已被外壳拦截，页面脚本自行监听 submit 并调用 `reportValidity()` 校验。
- `script` 以 `page`（本页根元素）和 `P` 为参数执行一次。`P` 提供 `h(tag, attrs, ...children)` 安全创建元素、`data`、`params`、`role`、`go(pageId, params)`、`onShow(pageId, fn)`、`onRole(fn)`、`setState(name)`、`loading(ms, then)`、`notify(text, kind)`。用户输入与示例数据用 textContent 或 `P.h` 输出。
- 页面要在 390px 手机宽度下可用：多列卡片用 `ui-grid`（自动换行），自己写网格时用 `repeat(auto-fit, minmax(min(100%, 200px), 1fr))`。三列及以上的固定网格、400px 以上的固定宽度必须配 `@media (max-width: 599px)` 改成单列，否则生成脚本拒绝。表格放在 `ui-table-scroll` 里横向滚动。
- `css` 只写本项目需要的补充布局规则，类名加项目前缀，不使用 url() 和 @import。颜色、字号、圆角、字体、阴影一律用 ui.css 的 `--ui-*` 变量（见 [内置 UI 规范](ui-design.md)），浅色底用 `color-mix(in srgb, var(--ui-accent) 12%, var(--ui-surface))` 这类写法。`css` 和 `style` 属性里写死的颜色（#hex、rgb()、hsl()、颜色名）、字号、字体、像素圆角都会被生成脚本拒绝，这样换设计规范时每一页都跟着变。

## 检查与生成

```bash
python3 product-requirements/scripts/prototype_design.py runs/.../project.json
python3 product-requirements/scripts/workflow.py --workspace <workspace> generate --run-dir <已确认版本> --version <新版本> --kind prototype
```

第一条在写入版本前检查设计稿并输出覆盖报告；第二条生成 prototype/index.html，覆盖报告写入 generation.json。检查项包括 FR／NFR 确认状态、需求覆盖或排除原因、NFR 体现或不适用原因、页面所属模块、标注、跳转、状态、角色、写死的样式和外部资源。脚本运行错误在页面内显示并记录到 `window.__prototypeErrors`，浏览器复核需另行完成。

## 客户意见

设置 `feedback_form_url` 后，客户直接打开原型时右下角显示“提意见”按钮。点击后进入点选模式，客户点中要评论的元素（或选“对整页提意见”，Esc 取消），飞书表单打开并自动带入页面、位置、所点元素的需求、原型版本和项目，客户只需写意见。位置描述取标签、按钮文字和表头，不取用户输入或示例数据。因此实现需求的元素都要标 `data-req`，意见才能挂到正确的需求。在工作台内预览时不显示该按钮。收回意见的方式见 [外部接入](ingestion.md)。

## 复核

工作台“原型预览”只展示原型，下方“当前页”卡片列出这一页所属模块、关联的 FR 与 NFR 和对应的技术实现，原型内跳转时同步切换；“标注需求”在原型上高亮对应元素；可在电脑、平板、手机尺寸间切换。负责人在原型上点选位置写修改意见，每行“【位置】意见”，复制给 Skill 只改这些地方；没有意见时确认并生成交付包。

## 原型之后：技术设计

技术设计是原型的技术实现，原型确认后再整理，写入 `apis`、`technical_architecture` 和 `business_model`：

1. 逐个原型页面列出它读写的数据和操作，落成接口草案，`apis[].page_ids` 写调用它的页面。
2. 接口按职责归到架构构件，前端构件和承载页面的服务在 `technical_architecture.components[].page_ids` 写它服务的页面。
3. 接口请求、响应用到的数据补进数据模型的实体和字段，和原型示例数据的字段对得上。
4. 每个页面都要有接口或构件承接；纯展示、无需后端的页面在构件里注明由前端静态实现。

工作台「技术设计 → 页面对照」按模块列出每个原型页面和承接它的接口、构件，没有承接的页面标“还没落到技术设计”。原型改版后，按新页面核对这张表再更新技术设计。
