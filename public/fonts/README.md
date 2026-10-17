# 套图固定字体

这两个字体仅在套图实际绘制文字时由浏览器加载，预览和单图编码使用相同文件。界面主题不改变成品字体或颜色。分发许可各自随附为 OFL 1.1 原文，保留原版权声明；不以字体作者名义背书产品。

来源：[Noto Sans SC](https://github.com/google/fonts/tree/main/ofl/notosanssc)、[Noto Sans](https://github.com/google/fonts/tree/main/ofl/notosans)。2026-10-17 从 Google Fonts 官方仓库读取可变 TTF，以 fonttools 4.60.1 和 Brotli 1.1.0 转为 WOFF2。保留权重与排版信息，字符子集为 U+0020–2FFF、U+3000–30FF、U+3400–4DBF、U+4E00–9FFF、U+FF00–FFEF 与字体原字符映射的交集。附属许可中的保留名 Source 未用于衍生字体命名。

`fontCoverage.ts` 从实际 WOFF2 的 cmap 生成；英文层含中文时固定回退至本地 Noto Sans SC，不支持的字符会阻止编码并提示编辑，避免系统字体改变版式。

| 文件 | 字节 | SHA-256 |
| --- | --- | --- |
| NotoSans.woff2 | 713908 | `e3a326bcaefd5b63320939d4cadbcd0a49a2243bf74ed8320dd12be1373384c5` |
| NotoSansSC.woff2 | 7609740 | `d47a208f209133cfe6b3a4cb64308908dfb092ab5377b7d834a92ab18c30d19b` |
