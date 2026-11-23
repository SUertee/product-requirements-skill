# 外部接入

会议内容优先从已有的会议工具取得：转写和说话人区分交给会议工具完成，本 Skill 负责之后的需求整理。下列接入都是可选项，缺少时退回逐字稿文件导入，主流程不受影响。

| 接入 | 依赖 | 自检 | 不可用时 |
| --- | --- | --- | --- |
| 飞书妙记 | `lark-cli`，用户身份登录，妙记权限 | `python3 scripts/feishu_connector.py --check` | 从会议工具导出 TXT／SRT／VTT 逐字稿导入 |
| 音视频预处理 | `ffmpeg` | `ffmpeg -version` | 等待逐字稿，任务停在 awaiting_transcript |
| 自建转写 | 用户配置的转写命令 | 见 [运行流程](execution.md) | 暂不提供默认服务 |

## 飞书妙记

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

## 逐字稿文件

任何会议工具导出的 UTF-8 TXT、Markdown、SRT、VTT 都可以直接导入，见 [输入与预处理](ingestion.md)。多数段落以“名字: ”或“说话人 1：”开头时，标准化会记录说话人；只有少数段落这样开头时视为普通文本，不记录说话人。
