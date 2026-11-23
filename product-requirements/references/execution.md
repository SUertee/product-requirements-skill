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

工作台“功能需求”可编辑字段与锁定选项，“评审记录”保存定义确认。应用意见会生成新版本。definition 评审绑定 project_id、artifact_version、decision_id 和 target，确认后的需求才进入原型生成。人工修改新增来源依据，分析结果中的锁定冲突写入 diff。运行 `generate` 前，若选择 `modules`、`architecture` 或 `workflow`，先按 [Archify 定位与按需下载](capabilities.md#缺少-archify-时按需下载) 准备依赖。

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

返回客户预览和 ZIP 路径。包状态为 package_ready，部署 URL 在实际部署后记录。完整发布评审保存在内部 release 目录的 review-notes.json，客户包保存其摘要和决定标识。包内保存所选原型及静态依赖、入口、manifest 和 release 记录。客户包范围、人工复核与发布授权见 [输出合同](output-contract.md)。

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
