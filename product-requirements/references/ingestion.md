# 输入与后台预处理

## 当前可运行入口

下列命令从本 Skill 包目录运行，即仓库中的 product-requirements/。

```bash
python3 scripts/normalize_transcript.py --input meeting.txt --project-id demo --output runs/demo/sources.jsonl
```

支持 UTF-8 TXT、Markdown、SRT、VTT。输出逐段来源 JSONL，包含稳定片段 ID、原文、时间或段落定位，以及从“名字: ”前缀识别的说话人。该脚本负责文本标准化，音频通过宿主中已配置且获授权的 ASR 服务取得逐字稿。

对于 DOCX、PDF 或会议链接，使用宿主可用的读取能力提取文本并保留原始定位。若读取失败，报告具体环节与可用导出方式。

## 录音、录屏与飞书接入

```bash
python3 scripts/ingest_material.py --input meeting.mp4 --project-id demo --workspace runs/demo/inbox
python3 scripts/feishu_connector.py --minutes 'https://example.feishu.cn/minutes/<token>' --project-id demo --workspace runs/demo/inbox
python3 scripts/serve_workbench.py --run-dir runs/demo/v0.1 --workspace runs/demo/inbox --port 8765
```

接收器保留原件、内容摘要与任务状态。文本生成 sources.jsonl 和 analysis-request.md，进入 ready_for_analysis。音视频在 ffmpeg 可用时提取单声道 16kHz WAV，进入 awaiting_transcript。录屏画面中的页面和操作理解仍待实现。失败保留原件与错误，通过 --retry 建立新尝试并保留 retry_of。逐字稿可使用 --related-job 关联同项目已接收的录音，网页提供对应选择。

飞书 Connector 默认获取所选妙记的逐字稿，--media 获取原始音视频。依赖、权限与自检见 [外部接入](ingestion.md)。指定链接即可获取，搜索、长连接事件与自动授权配置按实际宿主能力接入。权限不足时报告具体 scope。

本地工作台提供文件导入、Connector、接收箱及版本绑定的评审意见存储。分析请求交给主 Skill 执行，结合关联前情和已有基线整理 project.json，随后运行 build_documents.py 生成新版本。预处理完成后仍需执行语义分析。

ASR 服务由用户选择并授权数据目的地。现有妙记逐字稿可直接验证需求分析链路，原录制保留用于对照。

## 妙记输入链路

目标流程为会议云录制或上传音视频，等待妙记产物就绪，再由 Connector 获取逐字稿与按需获取的原件，标准化后交给主 Skill 分析。已有前情资料和需求基线与新材料一起核对，形成内部方案、PRD 与工作台，人工确认后继续生成客户原型。

会议录制需在飞书中开启云录制或设置自动录制。已有录音、录屏或录音豆导出文件可按实际支持的格式上传妙记，也可从本地入口接入已授权的转写能力。

当前通过指定妙记链接调用。自动发现和后台触发接入时，以所需产物可获取为条件，核对读取身份、权限和项目归属，再按材料与处理版本去重。产物未就绪保留等待状态，失败保留原件、原因与可恢复入口。intake_runner.py 已提供显式查询的妙记轮询，事件订阅及比赛宿主调用继续联调，命令见 [运行流程](execution.md)。

## 语音转写接入合同

转写适配器接收本地音频路径、语言提示和项目标识，返回带起止时间的文本片段、实际服务与模型版本、失败原因和可获得的耗时费用。未知说话人使用匿名标签。按服务实际支持的格式和大小处理输入。

取得用户对数据目的地的授权后向选定服务发送音频。密钥从运行环境读取，日志记录任务标识与错误摘要。

## Anker 硬件候选链路

录音豆 → 官方 App → 导出或受支持的连接方式 → PC 接收目录 → 后台任务 → Skill 草稿。

以 soundcore Work D3200 为公开资料参考，实际型号、地区、App 与固件版本待团队确认。官方描述连接 App 后同步至手机，开启 Cloud Sync 后提供 Online Hub 电脑网页访问。自动获取第三方音频的接口、SDK 与事件通知仍需验证。

- https://service.soundcore.com/article-description/soundcore-Work-FAQ
- https://www.soundcore.com/eu/products/d3200-soundcore-work-ai-voice-recorder

## 后台任务实施要求

由独立的 PC 运行器监听接收目录，确认文件传输完成后再调度。以内容摘要、项目与处理版本去重，原子认领任务，保留各阶段结果。并发接收同一材料复用同一任务，失败重试从可用阶段继续。项目关联不明时保留未归属草稿等待负责人选择。

运行器需要宿主支持无人值守调用，PC 保持运行。任务阶段为 received、normalized、analyzed、draft_ready 或 failed，失败记录具体阶段。本地接收器已实现预处理，intake_runner.py 提供目录稳定检测、持久状态及 ASR／分析命令适配，真实设备传输和宿主执行待实测。分析任务状态为 waiting_host、running、failed、completed，与接收阶段分别记录。

## 外部接入

会议内容优先从已有的会议工具取得：转写和说话人区分交给会议工具完成，本 Skill 负责之后的需求整理。下列接入都是可选项，缺少时退回逐字稿文件导入，主流程不受影响。

| 接入 | 依赖 | 自检 | 不可用时 |
| --- | --- | --- | --- |
| 飞书妙记 | `lark-cli`，用户身份登录，妙记权限 | `python3 scripts/feishu_connector.py --check` | 从会议工具导出 TXT／SRT／VTT 逐字稿导入 |
| 音视频预处理 | `ffmpeg` | `ffmpeg -version` | 等待逐字稿，任务停在 awaiting_transcript |
| 自建转写 | 用户配置的转写命令 | 见 [运行流程](execution.md) | 暂不提供默认服务 |

### 飞书妙记

调用前先运行自检。输出 JSON，`status` 为 `ready` 才导入；每个未通过的项目带 `fix`，原样告诉用户需要执行的命令，由用户完成登录与授权。

| 权限 | 用途 | 必需 |
| --- | --- | --- |
| `minutes:minutes.basic:read` | 读取妙记基本信息 | 是 |
| `minutes:minutes.transcript:export` | 导出逐字稿 | 是 |
| `minutes:minutes.search:read` | 按时间和参与人检索妙记 | 否 |
| `minutes:minutes.media:export` | 下载原始录音录像 | 否 |

导入指定妙记：

```bash
python3 scripts/feishu_connector.py --minutes 'https://<租户>.feishu.cn/minutes/<token>' --project-id <项目> --workspace <接收目录>
```

- 使用当前登录的用户身份，只能取得该用户有权访问的妙记，不切换为应用身份。
- 逐字稿以 SRT 导出，包含时间与说话人。标准化后每段来源保留原话，`speaker` 记录说话人，`locator` 记录起止秒数。未在妙记中改名的说话人显示为“说话人 2”这类匿名标签，不推断真实身份。
- `--media` 下载原始录音录像，用于核对。lark-cli 的下载地址校验可能拒绝，此时保留失败记录，不绕过校验。
- 只有本地录音时，可以由用户上传到飞书妙记生成逐字稿，再按上面方式导入。客户录音发送到第三方服务前需取得客户授权。

### 客户原型意见

客户看原型时的意见收集到一个飞书多维表格表单，团队在飞书里随时可见，不需要自建服务。

1. 新建多维表格，字段为文本：`意见`、`页面`、`位置`、`需求`、`原型版本`、`项目`、`称呼`。为它创建表单，`意见` 设为必填，开启分享。客户不在本组织时，分享范围需由负责人改为“任何人”。
2. 表单分享链接写入 `prototype_design.feedback_form_url`，重新生成原型。客户点“提意见”后在原型上点选一个位置，表单预填页面和位置（如“新建工单 › 客户手机号（输入框）”），需求取自所点元素最近的 `data-req`，与版本、项目一起隐藏；也可以对整页提意见。
3. 收回意见，作为素材导入：

```bash
python3 scripts/feishu_connector.py --feedback-table <多维表格 token>:<表 ID> --project-id <项目> --workspace <接收目录>
```

只导入本项目、尚未导入的意见，每个原型版本形成一份素材，进入下一次分析；工作台“功能需求”详情中按需求显示这些意见。已导入的记录 ID 保存在 `<接收目录>/prototype-feedback/imported.json`。需要 `base:record:read` 权限。

### 逐字稿文件

任何会议工具导出的 UTF-8 TXT、Markdown、SRT、VTT 都可以直接导入，见 [输入与预处理](ingestion.md)。多数段落以“名字: ”或“说话人 1：”开头时，标准化会记录说话人；只有少数段落这样开头时视为普通文本，不记录说话人。
