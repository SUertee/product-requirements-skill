# 华为平台与飞书接入核查

核对日期为 2026-11-17。范围为比赛可用的码道 CodeArts 和果办 OfficeAce，以及飞书妙记素材获取。

## 官方能力

码道 IDE 的 Agent Space 支持飞书 IM 集成，提供扫码或手动绑定，将工作空间和飞书机器人关联，通过聊天下发任务并接收执行反馈。根据该 IDE 文档，支持符合条件的 macOS Apple Silicon、Windows 和 Linux ARM64。桌面端另有飞书 IM 助理说明，具体入口和系统条件随使用形态核对。[码道 IDE 飞书集成](https://support.huaweicloud.com/usermanual-codeartsagent/codeartsagent_ug_0056.html)、[桌面端飞书集成](https://support.huaweicloud.com/usermanual-codeartsdesktop/desktop_0019.html)

果办 OfficeAce 的平台设置列出飞书、微信、钉钉和小艺接入，用于手机远程操控电脑。官方产品指南也列出语音转文字场景。所查页面的通讯接入说明覆盖远程交互，会议录制检索、下载和权限需沿妙记接口核查。[果办平台设置](https://support.huaweicloud.com/usermanual-officeace/officeace_02_0020.html)、[果办产品简介](https://support.huaweicloud.com/qs-officeace/introduction.html)

飞书官方提供妙记音视频下载和文字记录导出接口，官方妙记连接器也列出了音视频下载能力。实际资源需要具备访问和导出许可，原始音视频与逐字稿可以分别接入本项目。[妙记音视频下载](https://open.feishu.cn/document/minutes-v1/minute-media/get?lang=zh-CN)、[文字记录导出](https://open.feishu.cn/document/minutes-v1/minute-transcript/get)、[飞书妙记连接器](https://www.feishu.cn/content/980104538040)

## 项目接入设计

- 先接入指定妙记链接，使用已有逐字稿验证需求分析与原话回查，再使用同一妙记的音视频验证转写链路。
- 本地 Connector 通过 lark-cli 用户身份下载。接收器保留 provider、minute_token、identity 和 artifact 类型。
- 华为宿主中的飞书 IM 通道负责触发任务与反馈。会议数据由已授权的妙记读取能力获取，再进入统一输入合同。
- 后续可增加妙记生成事件触发，届时核对可订阅事件、签名校验、重放去重、宿主后台运行和授权主体。

以上为基于公开能力的实现路线。当前未在码道／果办客户端完成本项目联调。

## 当前实测

2026-11-17 以本机 lark-cli 1.0.97 用户身份检索 2026-11-01 至 2026-11-17 当前用户拥有的妙记，返回 missing_scope，缺少 minutes:minutes.search:read。对详情命令进行预检时缺少 minutes:minutes.basic:read。当前没有取得会议列表、原始内容或媒体文件。

用于后续测试的只读能力包括妙记搜索、基础信息、文字记录导出和音视频导出。具体 scope 以当前 CLI／API 实际要求为准，用户授权后仍需满足所选妙记的资源权限。多条候选由用户选择测试对象，再读取其内容。

## 样本验收

| 核对项 | 需要记录 |
| --- | --- |
| 原始素材 | 妙记链接、读取身份、媒体格式和时长 |
| 逐字稿 | 实际导出格式、说话人、时间戳粒度和可追溯定位 |
| 需求质量 | 原话支持、关键遗漏、推断标识、未知与冲突 |
| 音视频比较 | ASR 差错、时间对齐、画面信息是否另需提取 |
| 宿主运行 | 码道／果办版本、任务触发、依赖、结果路径与失败恢复 |

## 授权后核对

2026-11-17 完成用户授权并验证登录态有效，已具备妙记搜索、基础信息、文字记录导出和媒体导出四项权限。11 月 1—17 日“我拥有”和“我参与”均为空；按用户要求查询 10 月 1—31 日，两类结果去重后有 3 份妙记。具体测试对象待用户选择，尚未读取正文和下载媒体。

逐字稿 Connector 使用原生文字记录导出接口，file_format=srt，并请求说话人与时间戳。官方导出接口要求 minutes:minutes.transcript:export，已通过当前用户身份的请求预检。媒体继续使用 +download。下载通过临时工作目录和相对输出路径执行，实际返回文件位置会核对。
