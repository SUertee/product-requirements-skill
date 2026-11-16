# 输入与后台预处理

## 当前可运行入口

```bash
python3 scripts/normalize_transcript.py --input meeting.txt --project-id demo --output runs/demo/sources.jsonl
```

支持 UTF-8 TXT、Markdown、SRT、VTT。输出逐段来源 JSONL，包含稳定片段 ID、原文和时间或段落定位。该脚本负责文本标准化，音频先通过宿主中配置的 ASR 服务取得逐字稿。

对于 DOCX、PDF 或会议链接，使用宿主可用的读取能力提取文本并保留原始定位。若读取失败，报告具体环节与可用导出方式。

## 音频与视频的能力边界

MP3、M4A、WAV、AAC、MP4、MOV 只是可接受的输入类型，不代表 Skill 内置 ASR。优先使用宿主已经提供且获得用户授权的转写工具，并保存实际工具、模型版本（若可得）和失败原因。宿主没有转写或媒体读取能力时，明确请求 TXT、SRT 或 VTT；不得声称音频已处理，也不得伪造转写文本。

## 语音转写接入合同

团队成员实现的转写适配器接收本地音频路径、语言提示和项目标识，返回带起止时间的文本片段、实际服务与模型版本、失败原因和可获得的耗时费用。未知说话人使用匿名标签。按服务实际支持的格式和大小处理输入。

取得用户对数据目的地的授权后向选定服务发送音频。密钥从运行环境读取，日志记录任务标识与错误摘要。

## Anker 硬件候选链路

录音豆 → 官方 App → 导出或受支持的连接方式 → PC 接收目录 → 后台任务 → Skill 草稿。

以 soundcore Work D3200 为公开资料参考，实际型号、地区、App 与固件版本待团队确认。官方描述连接 App 后同步至手机，开启 Cloud Sync 后提供 Online Hub 电脑网页访问。自动获取第三方音频的接口、SDK 与事件通知仍需验证。

- https://service.soundcore.com/article-description/soundcore-Work-FAQ
- https://www.soundcore.com/eu/products/d3200-soundcore-work-ai-voice-recorder

## 后台任务实施要求

由独立的 PC 运行器监听接收目录，确认文件传输完成后再调度。以内容摘要、项目与处理版本去重，原子认领任务，保留各阶段结果。并发接收同一材料复用同一任务，失败重试从可用阶段继续。项目关联不明时保留未归属草稿等待负责人选择。

运行器需要宿主支持无人值守调用，PC 保持运行。任务阶段为 received、normalized、analyzed、draft_ready 或 failed，失败记录具体阶段。工程实现和真实设备测试由接入负责人完成。
