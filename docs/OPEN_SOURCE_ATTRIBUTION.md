# 第三方开源归属与复用说明

本项目没有复制七个参考仓库的代码、模板或测试文件，因此没有捆绑其源码或许可证正文。以下仅记录设计参考。详细源码审计见 [OPEN_SOURCE_AUDIT.md](OPEN_SOURCE_AUDIT.md)。

| 项目 | 审计提交 | 许可证核查 | 本项目使用方式 |
|---|---|---|---|
| franklinxkk/ai-delivery-spec | e76b55007abc278c5b7a88e0648ea36ac99ad2d6 | MIT | 需求身份、人工门禁、变更影响与验证思路 |
| raduandreibulai/prd-agents | 157602b03c54813b67cd8e27b135a2c9f5cd77ea | MIT | Context Pack 与职责顺序参考 |
| Leo-maomao/pm-copilot | 0f9e4079464af641264668f0623604c52f990a0f | 未找到 | 仅参考文件型统一需求对象，不复制代码 |
| erikholmberg/prd-to-prototype | 49434d8044becef63b68d385014e7b39173089cb | MIT | 共享 REQ/验收、确定性检查与评估思路 |
| mirabradshaw-data/chalky-prd | e668c6dc10988736cf41619d0a233ba50dcd81e2 | MIT | 原话、草稿与事实/推断分离 |
| MadhanMohanReddy2301/TraceX-backend | e49370b782ebef347e43933f670485a6963245ac | 未找到 | 仅参考需求到验收追溯，不复制代码 |
| initmahesh/ai-prd-builder | 48b10c7a0e9682b03f40e6ad88d0e7d6f5d45005 | 未找到 | 仅参考 Skill 检查点和质量清单组织 |
| phuryn/pm-skills | 9af7bfd0bc47fdad43c2eaa7a43cd13918e7aaef | MIT | 选择性吸收精简 PRD、用户故事、测试场景、优先级与风险审查方法；外部 Skill 可选定位 |
| Emmraan/agent-skills | 4c2ea06aa2aba5465a0f088228283f34fc9dae5b | MIT | 将 requirements-analysis 方法收敛为现有 REQ 的质量门禁 |
| AIPris/code-to-diagram | 0ab6520f648f46aaaab918d5d6dc3c948cf0877a | MIT | 时序／状态／类图的可选 `.mmd`→draw.io／PNG 能力 |
| alchaincyf/huashu-design | e8d1148a80d5a281d4247cffe320add3df017928 | MIT；部分演示素材单独许可 | 已批准简报的可选 deck／PPTX 导出，不捆绑其素材 |

`integrations.json` 记录 Archify、选定 PM Skills、Requirements Analysis、Code to Diagram、Huashu Design 固定提交及 Schema Canvas 用户自有依赖。它们都是可选宿主能力，不由本包捆绑；解析器只定位真实 SKILL.md，不自动下载或执行。缺失时按 references 记录失败，不伪装调用或导出成功。
