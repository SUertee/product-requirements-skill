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

打开命令返回的工作台地址。在会议素材页导入文件或指定妙记，评审页记录意见。静态 HTML 可以独立浏览，本地运行器提供导入和评审持久化。

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

同一成功输入复用既有任务，预处理失败可通过页面“重试预处理”或 CLI `--retry` 创建新尝试，原失败记录保留。失败重试通过 retry_of 关联。逐字稿可以通过页面选择关联录音，或使用 --related-job JOB-ID，关联对象必须属于同一项目。后台稳定目录监听和语义分析自动调度待接入。

## 飞书 Connector

```bash
python3 product-requirements/scripts/feishu_connector.py \
  --minutes 'https://example.feishu.cn/minutes/<minute_token>' \
  --workspace runs/customer/inbox \
  --project-id customer-demo
```

默认获取逐字稿，增加 `--media` 获取原始音视频。使用本机 lark-cli 的用户身份，从命令返回的实际文件路径进入统一接收器。下载目录约束与文件存在性会核对，错误反馈保留所缺 scope。

lark-cli 用户授权和妙记本身的访问／导出许可分别需要满足。当前仅实现指定链接获取，会议搜索和事件订阅由后续连接器扩展。2026-11-17 初次核对存在 scope 缺失，补授权后搜索、基础信息、文字记录导出和媒体导出权限均已验证生效。已找到 10 月的妙记候选，具体对象待选择，真实内容与媒体尚未获取。逐字稿通过原生导出接口请求 SRT、时间戳与说话人，媒体通过 +download 获取。

## 本地接口

| 接口 | 输入／输出 |
| --- | --- |
| GET /api/status | 当前项目、版本、本机能力、接收任务、评审记录 |
| POST /api/import?filename=… | 原始文件字节 → 预处理任务 |
| POST /api/feishu | minutes 链接、media 布尔值 → 下载并预处理 |
| POST /api/retry | 失败 job_id → 新预处理尝试 |
| GET /api/jobs/{id}/{key} | 原件、音轨、来源片段或分析请求 |
| POST /api/review | revision、target、outcome、comment、reviewer → 版本绑定意见 |

网页操作使用同源请求，写操作带 X-Workbench-Request 请求头。只提供当前运行清单和本项目任务文件，媒体支持字节范围读取。服务面向本机开发，运行目录与接收箱由启动参数指定。

评审意见写入 workspace/reviews.sqlite3，绑定项目和成果版本，revision 防止覆盖较新的记录。结论可以为 confirmed、needs_changes 或 parked。导出的 review-notes.json 供 Skill 修订使用，既有 project.json 和 review.json 保留当前生成基线。

## 已执行验证

- Python 单元与 HTTP 测试覆盖原件保留、来源定位、同输入并发去重、项目隔离、失败重试、依赖缺失、Connector 文件路径、缺 scope、同源写入约束、评审 revision 与文件范围读取。
- 使用 2 秒合成音调视频实测音轨提取，WAV 为 16kHz 单声道，共 32000 帧。
- DOM 测试检查页面切换、模块筛选、来源回查、文档切换和技术标签。
- 真实客户样本、ASR、语义自动调度、真实浏览器布局和媒体播放尚待验证。
