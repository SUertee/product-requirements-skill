# 输入与本地工作台

2026-11-17 开发。Python 3.11、本机 ffmpeg 与 lark-cli 环境。界面沿用包内 workbench 模板，服务只监听 127.0.0.1。

## 本地运行

从仓库根目录运行，run-dir 使用已生成版本，workspace 使用当前项目的本地接收箱。

```bash
python3 product-requirements/scripts/serve_workbench.py \
  --run-dir runs/intake-development/workbench-live \
  --workspace runs/intake-development/session-inbox \
  --port 8765
```

打开命令返回的工作台地址。在会议素材页导入文件或指定妙记，评审页记录意见。静态 HTML 可以独立浏览，本地运行器提供导入、分析任务、评审应用、生成和客户包。完整链路见 [运行流程](../../product-requirements/references/execution.md)。

## 文件接入

```bash
python3 product-requirements/scripts/ingest_material.py \
  --input /path/to/meeting.mp4 \
  --workspace runs/customer/inbox \
  --project-id customer-demo
```

支持 TXT、MD、SRT、VTT、MP3、WAV、M4A、AAC、OGG、FLAC、MP4、MOV、WEBM、MKV。网页每文件接收上限为 256MB，CLI 可处理更大文件。音视频使用可用的 ffmpeg 提取 16kHz 单声道 WAV，等待 ASR 或外部逐字稿。录屏画面理解待实现。

输入目录中的文件由调用者确认已传输完成。网页上传完成后才启动预处理。以项目、内容摘要、格式、来源和处理器版本生成任务 ID，原始文件与处理产物保存在 `workspace/jobs/JOB-*/`。

| 状态 | 含义 | 下一处理 |
| --- | --- | --- |
| ready_for_analysis | 来源 JSONL 已生成，保留原话与定位 | 宿主执行主 Skill |
| awaiting_transcript | 原始音视频已接收，已有音轨时一并保留 | ASR 或导入对应逐字稿 |
| failed | 当前预处理失败，原件与原因保留 | 修复输入／依赖后重试 |

同一成功输入复用既有任务，预处理失败可通过页面“重试预处理”或 CLI `--retry` 创建新尝试，原失败记录保留。失败重试通过 retry_of 关联。逐字稿可以通过页面选择关联录音，或使用 --related-job JOB-ID，关联对象必须属于同一项目。intake_runner.py 提供稳定目录监听、显式妙记轮询和配置命令调用，真实 ASR 与比赛宿主继续联调。

## 飞书 Connector

```bash
python3 product-requirements/scripts/feishu_connector.py \
  --minutes 'https://example.feishu.cn/minutes/<minute_token>' \
  --workspace runs/customer/inbox \
  --project-id customer-demo
```

默认获取逐字稿，增加 `--media` 获取原始音视频。使用本机 lark-cli 的用户身份，从命令返回的实际文件路径进入统一接收器。下载目录约束与文件存在性会核对，错误反馈保留所缺 scope。

lark-cli 用户授权和妙记本身的访问／导出许可分别需要满足。指定链接获取与显式查询的就绪轮询已实现，平台事件订阅待联调。2026-11-17 初次核对存在 scope 缺失，补授权后搜索、基础信息、文字记录导出和媒体导出权限均已验证生效。用户选定的 10 月 25 日会议已取得 198 条来源片段。媒体下载被 lark-cli 的本地／内部地址校验拒绝，原件比对待补充。逐字稿通过原生导出接口请求 SRT、时间戳与说话人，媒体通过 +download 获取。

## 本地接口

| 接口 | 输入／输出 |
| --- | --- |
| GET /api/status | 当前项目、版本、本机能力、接收／分析任务、评审与客户包 |
| POST /api/import?filename=… | 原始文件字节 → 预处理任务 |
| POST /api/feishu | minutes 链接、media 布尔值 → 下载并预处理 |
| POST /api/retry | 失败 job_id → 新预处理尝试 |
| GET /api/jobs/{id}/{key} | 原件、音轨、来源片段或分析请求 |
| POST /api/review | revision、review_stage、target、outcome、comment、reviewer → 版本绑定意见 |
| POST /api/analysis | 选定 job_ids、context_job_ids 与目标版本 → 分析任务 |
| POST /api/analysis/complete | request_id、project → 校验并生成版本 |
| POST /api/analysis/execute | request_id → 使用启动时配置的宿主执行 |
| POST /api/review/apply | revision、version、changes → 应用定义评审 |
| POST /api/transcribe | job_id → 使用启动时配置的 ASR 转写 |
| POST /api/generate | version、kinds → 独立生成并登记成果 |
| POST /api/release | 选定文件与发布评审 → 客户包 |
| GET /versions/{id}/{path} | 已登记版本的实际文件 |
| GET /customer/{id}/{path} | 客户包中允许的静态文件 |

网页操作使用同源请求，写操作带 X-Workbench-Request 请求头。只提供当前运行清单和本项目任务文件，媒体支持字节范围读取。服务面向本机开发，运行目录与接收箱由启动参数指定。

评审意见写入 workspace/reviews.sqlite3，绑定项目和成果版本，revision 防止覆盖较新的记录。结论可以为 confirmed、needs_changes 或 parked。导出的 review-notes.json 供 Skill 修订使用，既有 project.json 和 review.json 保留当前生成基线。

## 已执行验证

- Python 单元与 HTTP 测试覆盖原件保留、来源定位、同输入并发去重、项目隔离、失败重试、依赖缺失、Connector 文件路径、缺 scope、同源写入约束、评审 revision 与文件范围读取。
- 使用 2 秒合成音调视频实测音轨提取，WAV 为 16kHz 单声道，共 32000 帧。
- DOM 测试检查页面切换、模块筛选、来源回查、文档切换和技术标签。
- 真实逐字稿导入、当前助手分析、浏览器原型和修订流程已实测。真实 ASR、码道自动调用、媒体播放与公网部署仍待验证。
