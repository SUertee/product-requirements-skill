# UI/UX Pro Max 参考

来源为 [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)，许可证 MIT。当前工程固定提交 `b73ee96f8d4ff7bbc279c52dadcd907ffe23629c`，入口为仓库内 `.claude/skills/ui-ux-pro-max/SKILL.md`。来源、提交与环境变量在 [integrations.json](../../product-requirements/integrations.json) 维护。

2026-11-26 接入前审阅了 `scripts/search.py`、`core.py`、`design_system.py`、`reasoning_contract.py` 和 `preview.py`：只用 Python 标准库，不联网、不执行外部命令，只在显式保存时写文件；SKILL.md 与 references 中没有要求 Agent 执行额外操作的内容。升级固定提交前重新审阅。

## 参考与接入范围

| 参考能力 | 本项目位置 | 采用状态 |
| --- | --- | --- |
| `--design-system` 按产品类型推荐配色、风格与字体 | 原型设计第 1 步，经 `prototype_design.py --theme-from` 转成 positioning.theme | 已接入 |
| 交付前检查清单（对比度、焦点、触控、窄屏、减少动效） | 原型生成后核对，未通过项写入 design_context.review_notes | 已写入流程 |
| 风格特效（毛玻璃、黏土等）、Google 字体、落地页版式、深色模式 | 不带入：原型是浅色单文件页面，组件用统一规范 | 不采用 |

## 本地入口

```bash
python3 product-requirements/scripts/generate_artifacts.py --locate ui-ux-pro-max
```

配置 UI_UX_PRO_MAX_SKILL_DIR 指向 `ui-ux-pro-max/` 目录可选择其他安装位置。本地找不到时按 [按需下载](../../product-requirements/references/execution.md#缺少依赖时按需下载) 下载固定提交。查询词只写产品类型、行业和风格，不写客户名称和项目内部信息。
