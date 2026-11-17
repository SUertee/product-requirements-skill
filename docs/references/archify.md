# Archify 参考

上游为 [tt-a1i/archify](https://github.com/tt-a1i/archify)，当前工程固定提交 `e37848822238e3a61b12739185cdadd49843a620`。主入口为仓库中的 archify/SKILL.md。来源、提交与环境变量在 [integrations.json](../../skills/product-requirements-skill/integrations.json) 维护。

## 参考与接入范围

- 参考主入口的任务路由、按需读取、执行流程、交付检查和结果输出组织方式。
- 通过主 Skill 传入业务流程与架构关系，使用上游渲染与检查能力生成可嵌入工作台的 HTML 图示。
- 将候选输入、项目版本、来源与实际检查结果关联到项目产物。

## 本地入口

从仓库根目录执行以下命令获取实际入口，再读取对应 SKILL.md。

```bash
python3 skills/product-requirements-skill/scripts/resolve_capability.py archify
```

实现副本位于工程旁的 skill-dependencies/archify/，可使用 ARCHIFY_SKILL_DIR 指向其他安装位置。当前固定版本采用 Apache-2.0，分发时遵守上游 LICENSE、NOTICE 和适用第三方声明。上游文件与许可证保存在该实现副本中。
