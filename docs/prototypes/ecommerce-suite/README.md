# 电商套图工作台原型基线

用户于 2026-10-17 提供「套图工作台-html (1).zip」。本目录保存原始字节，供[开发计划](../../ecommerce-suite-development-plan.md)引用和后续视觉验收。

| 项目 | 内容 |
| --- | --- |
| 原始归档 | [workspace-v1.zip](workspace-v1.zip) |
| SHA-256 | `4a100dba9c3dc120c2c9d8bb1639b653cdfaf365bebf0e44b304a5986670e048` |
| 主文件 | `Main.dc.html` |
| 设计参考尺寸 | 1440 × 900 |
| 其他文件 | `README.md`、`support.js`、`vendor/react.js`、`vendor/react-dom.js` |

原型包含工作台布局、7 槽位、三页签、文字编辑、版本和主题切换演示。沙发是 HTML 图形，费用、进度、生成与版本数据是演示状态；不能视为真实生成、计费或后台执行证据。

附件未包含链接指向的 `List.dc.html`、`ToolReturn.dc.html`、`Export.dc.html`。整体风格重生成、真实生成、图层拖拽、实际预检和导出须按计划补齐。导航与主题复用现有组件和变量，右下角演示主题开关不进入正式产品。

从仓库根目录执行下列命令，在临时目录解压预览，不修改归档：

```bash
python3 -m zipfile -e docs/prototypes/ecommerce-suite/workspace-v1.zip /tmp/pixel-ecommerce-suite-reference
python3 -m http.server 43871 --bind 127.0.0.1 --directory /tmp/pixel-ecommerce-suite-reference
```

浏览器打开 `http://127.0.0.1:43871/Main.dc.html`；结束后按 `Ctrl+C` 停止临时服务。

后续原型使用新文件名与校验值归档，不覆盖本附件；同步更新计划中的基线与交互差异。
