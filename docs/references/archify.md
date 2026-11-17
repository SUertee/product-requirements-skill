# Archify 参考

上游为 [tt-a1i/archify](https://github.com/tt-a1i/archify)，当前工程固定提交 `e37848822238e3a61b12739185cdadd49843a620`。主入口为仓库中的 archify/SKILL.md。来源、提交与环境变量在 [integrations.json](../../product-requirements/integrations.json) 维护。

## 参考与接入范围

- 参考主入口的任务路由、按需读取、执行流程、交付检查和结果输出组织方式。
- 通过主 Skill 传入业务流程与架构关系，使用上游渲染与检查能力生成可嵌入工作台的 HTML 图示。
- 将候选输入、项目版本、来源与实际检查结果关联到项目产物。

## 本地入口

从仓库根目录执行以下命令获取实际入口，再读取对应 SKILL.md。

```bash
python3 product-requirements/scripts/resolve_capability.py archify
```

实现副本位于工程旁的 skill-dependencies/archify/，可使用 ARCHIFY_SKILL_DIR 指向其他安装位置。当前固定版本采用 Apache-2.0，分发时遵守上游 LICENSE、NOTICE 和适用第三方声明。上游文件与许可证保存在该实现副本中。


## 在本项目中的采用位置

| 参考能力 | 本项目位置 | 采用状态 |
| --- | --- | --- |
| 任务路由与按需参考 | 主 Skill 的任务路由及包内 references | 已写指令结构 |
| 流程／架构 HTML 渲染和检查 | M06、capabilities.md、integrations.json | 已定位固定实现，输入适配待实现 |
| 交付与恢复信息 | manifest 的实际结果和错误记录 | 已定义合同，自动生成待实现 |

固定源文件可从上述提交的 archify/SKILL.md、archify/references/ 和 archify/bin/ 读取。修改集成前核对固定版本对应的输入格式，按上游实际检查结果登记生成状态。
