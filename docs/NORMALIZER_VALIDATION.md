# 逐字稿标准化验证记录

## 实际环境

- Windows 11 工作区，CodeArts 命令沙箱。
- Python 3.11.15。
- 仅使用 Python 标准库。

## 原问题与处理

原实现使用 `NamedTemporaryFile`，在此前沙箱中于写入阶段出现 `[Errno 9] Bad file descriptor`；独立的最小 `NamedTemporaryFile` 示例也失败，因此不能据此判定字幕解析错误。

现实现保留原子写入，但显式拆分生命周期：

1. `tempfile.mkstemp` 在目标同目录创建临时文件。
2. `os.fdopen` 写入完整 JSON/JSONL，退出 with 后关闭描述符。
3. `os.replace` 原子替换目标。
4. 异常时关闭剩余描述符并清理临时文件，保留旧文件。

没有通过直接写目标文件或删除原子替换来绕过问题。

## 实际验证

- TXT、Markdown、SRT、VTT 正常解析。
- 非法时间戳、空文件、不支持格式均返回失败。
- 重复输入得到相同 SHA-256、Source ID 和 Segment ID。
- SourceMaterial 与 TranscriptSegment 使用独立 ID。
- 原话、说话人匿名标签、段落和时间定位保留。
- CLI 完整执行成功并生成 Source 与 Transcript JSONL。
- 模拟 `os.replace` 失败时旧文件内容不变，临时文件被清理。
- 完整单元/集成测试最终全部通过，见 `docs/VALIDATION_REPORT.md`。

## 边界

这证明当前环境中的代码路径通过，不代表所有操作系统和所有 Agent 沙箱均已验证。音频/视频不由本脚本转写；宿主缺少授权 ASR 时必须请求文本或字幕。
