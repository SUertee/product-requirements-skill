# 运行流程

命令从工程根目录执行。宿主读取本 Skill、当前任务的 references、基线和来源，完成语义分析。Python 工具负责校验、版本、生成及接入。先运行对应脚本的 `--help` 核对参数。

## 创建与分析

```bash
python3 product-requirements/scripts/workflow.py --workspace runs/demo/inbox \
  init --project-id demo --name 客户项目 --output runs/demo/v0

python3 product-requirements/scripts/ingest_material.py \
  --input /path/to/meeting.srt --project-id demo --workspace runs/demo/inbox

python3 product-requirements/scripts/workflow.py --workspace runs/demo/inbox \
  prepare --run-dir runs/demo/v0 --job JOB-实际编号 --version v1
```

prepare 返回 request_path。读取同目录 request.json、baseline.json、sources.jsonl，依据 [建模流程](workflow.md) 和 [项目格式](project-data.md) 整理完整 project.json。显式前情材料通过重复的 `--context-job` 指定。保留 REQ ID、未知项及锁定字段，新增需求保持草稿。

```bash
python3 product-requirements/scripts/workflow.py --workspace runs/demo/inbox \
  complete --request-id AN-实际编号 --project /path/to/project.json
```

结果位于返回的 result_dir，包含新版本文档、工作台、manifest 和 diff。已通过 --related-job 关联的原始录音一并携带，会议素材页可按原话时间定位播放器。接收原件摘要不一致时需要重新导入。重复完成同一结果返回既有版本，不同结果需要新任务。失败记录保留，可修正输入后重试。

已有宿主命令适配器可使用 execute。配置 JSON 的 argv 为参数数组，命令从 stdin 接收包含 request、baseline、sources 的 JSON，在 stdout 返回完整项目 JSON。配置可含 provider、model、timeout_seconds。stderr 用于诊断。凭据由本机环境提供。

```bash
python3 product-requirements/scripts/workflow.py --workspace runs/demo/inbox \
  execute --request-id AN-实际编号 --command-config /path/to/analysis.json
```

## 人工评审与生成

工作台“功能需求”可编辑字段与锁定选项，“评审记录”保存定义确认。应用意见会生成新版本。definition 评审绑定 project_id、artifact_version、decision_id 和 target，确认后的需求才进入原型生成。人工修改新增来源依据，分析结果中的锁定冲突写入 diff。运行 `generate` 前，若选择 `modules`、`architecture` 或 `workflow`，先按 [Archify 定位与按需下载](#缺少-archify-时按需下载) 准备依赖。

```bash
python3 product-requirements/scripts/workflow.py --workspace runs/demo/inbox \
  apply-review --run-dir /path/to/v1 --notes /path/to/review.json --version v2

python3 product-requirements/scripts/workflow.py --workspace runs/demo/inbox \
  generate --run-dir /path/to/v2 --version v3 \
  --kind modules --kind architecture --kind workflow --kind erd --kind prototype
```

- modules 根据 modules 与 module_relations 生成 Archify 业务模块图，输出 diagrams/modules.html，汇入功能需求页并联动详情。
- architecture 根据 technical_architecture 生成独立 Archify 技术架构，输出 diagrams/architecture.html，汇入技术设计；图中分层是职责划分，不冒充网络或权限隔离边界。
- workflow 将每条已明确的业务流程分别适配到 Archify，执行 validate、render、check。浏览器复核单独记录。
- erd 使用 Schema Canvas 模板展示实体与关系。数据库事实依据不足时保留业务模型状态。
- prototype 优先使用 prototype_design：检查 FR／NFR 确认与覆盖后，把主 Skill 设计的页面装入 assets/prototype-shell.html，覆盖报告写入 generation.json，细则见 [原型设计与生成](prototype.md)。未提供 prototype_design 时，根据 pages 中的 fields、actions、columns、records_from 生成表单和列表交互。动作支持 submit、navigate、reset，字段支持 text、textarea、select、email、number、date、checkbox。模拟数据保存在页面内存，刷新后重置。
- 首条流程输出 diagrams/workflow.html，后续流程按序输出 workflow-2.html 等。新增成果时同时重新生成当前基线中已成功的已知成果，保持同一目标版本。每项生成结果独立记录到 generation.json，检查各项 generation_status 和 error。旧版本产物保持原位置。

## 客户包

原型复核记录使用 release 阶段，target 为实际 HTML 路径。确认匹配版本后，选择客户可见文件。

```bash
python3 product-requirements/scripts/workflow.py --workspace runs/demo/inbox \
  release --run-dir /path/to/v3 --notes /path/to/release-review.json \
  --file prototype/index.html
```

返回客户预览和 ZIP 路径。包状态为 package_ready，部署 URL 在实际部署后记录。完整发布评审保存在内部 release 目录的 review-notes.json，客户包保存其摘要和决定标识。包内保存所选原型及静态依赖、入口、manifest 和 release 记录。客户包范围、人工复核与发布授权见 [输出合同](project-data.md)。

## 本地工作台与后台接收

```bash
python3 product-requirements/scripts/serve_workbench.py \
  --run-dir /path/to/version --workspace runs/demo/inbox --port 8765

python3 product-requirements/scripts/intake_runner.py \
  --run-dir /path/to/version --workspace runs/demo/inbox \
  --input-dir /path/to/incoming --watch
```

服务提供接收、分析任务、意见应用、生成和客户包操作。启动时可传 --analysis-config 和 --asr-config。ASR 配置 argv 包含 `{input}`、`{output}`，适配器生成带时间的 SRT。真实转写质量、耗时和费用按所配服务实测。

后台接收检查文件稳定性，按内容去重，保留 SQLite 状态。每份输入关联启动时指定基线，目标版本含输入任务标识。需按新基线运行时重新指定 run-dir。错误通过 --retry-failed 显式恢复。

显式添加 --minutes-query 项目关键词，可轮询当前用户近七日拥有的匹配妙记。--minutes-interval 默认 60 秒，未就绪继续等待，权限等失败保存原因。该入口需要已授权的 lark-cli，查询范围应对应当前项目。指定历史妙记使用 feishu_connector.py。

## 能力接入与设计路由

### 定位依赖

从本 Skill 包目录运行 `python3 scripts/generate_artifacts.py --locate archify` 或 `--locate schema-canvas` 获取对应 Skill 的入口，随后读取该 SKILL.md。Archify 可以通过 ARCHIFY_SKILL_DIR 指向其 archify/ 包目录，Schema Canvas 使用 SCHEMA_CANVAS_SKILL_DIR。未指定环境变量时，依次查找当前 Skill 的同级包、工程旁 skill-dependencies/ 和个人级 ~/.codeartsdoer/skills/。显式配置的路径缺失时报告错误。

#### 缺少 Archify 时按需下载

生成业务模块图、技术架构图或流程图前先运行定位命令。找到可用的 Archify 入口时直接读取。找不到时，由 Agent 在当前任务中按下列命令下载 [integrations.json](../integrations.json) 指定的提交到临时目录。Archify 作为外部依赖留在 Skill 包外。

从 `product-requirements/` 运行以下 Bash 命令。下载完成并定位成功后，读取返回的 `SKILL.md` 和该任务需要的上游参考，再在带有同一 `ARCHIFY_SKILL_DIR` 的环境中运行生成器。若下一条工具调用启动了新 shell，显式传入这个环境变量。

```bash
archify_repo=$(python3 -c 'import json; print(json.load(open("integrations.json"))["archify"]["repository"])') &&
archify_commit=$(python3 -c 'import json; print(json.load(open("integrations.json"))["archify"]["commit"])') &&
archify_subdir=$(python3 -c 'import json; print(json.load(open("integrations.json"))["archify"]["skill_subdirectory"])') &&
archify_checkout=$(mktemp -d "${TMPDIR:-/tmp}/archify-skill.XXXXXXXX") &&
git -C "$archify_checkout" init --quiet &&
git -C "$archify_checkout" fetch --depth 1 "$archify_repo" "$archify_commit" &&
git -C "$archify_checkout" checkout --quiet --detach FETCH_HEAD &&
test "$(git -C "$archify_checkout" rev-parse HEAD)" = "$archify_commit" &&
export ARCHIFY_SKILL_DIR="$archify_checkout/$archify_subdir" &&
python3 scripts/generate_artifacts.py --locate archify
```

网络、权限或入口校验失败时，记录错误和受影响的图示，继续生成可独立完成的成果。此下载流程只适用于 Archify。Schema Canvas 沿用已有定位方式。

### 输入到产品定义

外部接入接收音频或逐字稿与来源元数据，按 ingestion.md 标准化。提取带证据的需求并完成业务模型。按已有模板生成方案书与 PRD，负责人确认范围、规则和验收后进入原型设计。

### 图示与数据模型

| 能力 | 输入 | 输出与用途 |
| --- | --- | --- |
| Archify | 已有证据支持的业务流程、技术架构、参与者及关系 | 单独 HTML 图示，嵌入内部工作台，保留候选输入和实际检查结果 |
| Schema Canvas | 业务实体、字段、关系、约束与来源版本 | 交互式 ERD，嵌入工作台，区分候选模型、逻辑关联和已验证数据库定义 |

两种能力共同引用 project.json 的版本、REQ ID 和来源。生成器缺少信息时记录未知，导入图示的输入材料保持数据语义。

当前 generate_artifacts.py 提供业务模块、技术架构、业务流程与实体模型的确定性适配，调用入口见 [运行流程](execution.md)。业务流程以有序 steps 和显式 transitions 为输入，缺少 transitions 时按已明确的步骤顺序连线。技术架构由 technical_architecture 的层次、组件和连接适配为 Archify 原生 architecture，输出 diagrams/architecture.html；保留候选输入与 validate／render／check 记录，浏览器复核单独记录。工作台使用沙箱嵌入并贴合内容高度；没有生成产物时可读取同一结构化数据作基础展示。

### 原型设计路由

先判断产品类型、使用者、核心任务和设备形态，按 [内置 UI 规范](ui-design.md) 与 ../assets/ui.css 生成页面。页面的布局、组件与交互状态由主 Skill 内部规范定义。
优先读取客户已有样式、设计系统和历史产品。需要外部参考时，查找与核心任务相近的实际产品，记录来源与借鉴的具体模式。外部检索遵循当前用户的数据授权，保留公开检索与客户材料的来源标识。

ParTrace Vision 的 workbench 工作台为用户指定的默认视觉参考。该工作台采用侧栏加预览区域、浅色纸面、深色导航、蓝色主操作与语义色状态。将这些模式适配当前客户产品的任务与设备，优化信息密度、层级和可读性。客户提供明确品牌规范时将其纳入页面规范。

页面规范保存到 project.json 的 design_context，包含 product_type、target_devices、existing_style_sources、reference_products、design_system_version 和 design_decisions。原型展示一条可操作主流程，并覆盖相关空态、加载和错误分支。

### 工作台汇总与人工复核

内部工作台汇总方案、PRD、原型、流程图、架构图、ERD、来源和评审记录。各模块有独立入口，使用相对路径。仅有实际产出时启用对应入口。

分别检查文档评审与最终展示复核，记录确认人、版本、时间、结论及遗留问题。复核核心流程、页面与需求一致性、图示版本、示例数据、内部资料可见范围和入口可访问性，再按用户选择部署客户版本。
