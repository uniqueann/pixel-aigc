# 工具箱 · 转比例 — 开发规划

> 与 [`architecture.md`](./architecture.md) §6 对齐。加水印批量链路已落地，转比例复用同一套工具箱骨架。

## 1. 目标

电商运营将同一张商品图输出为多个平台规格（见 `src/constants/platformSizes.ts`），支持三种适配策略，批量本机队列 + 可选 AI 扩图，输出可 ZIP 打包。

| 能力 | 说明 |
|------|------|
| 多选平台 | 一次勾选多个 `PlatformSizePreset`，每张原图对每个 preset 各出一份 |
| 适配策略 | 留白填充 / **智能裁剪** / 智能扩展（复用扩图 Capability） |
| 批量 | 与水印一致：最多 20 张、JPG/PNG/WebP、队列预览与逐张/ZIP 下载 |
| 路由 | `/toolbox/aspect-ratio`，独立 `AspectRatioTool`（lazy），占位见 `Toolbox/index.tsx` |

## 2. 已锁定产品决策

| # | 议题 | 决策 |
|---|------|------|
| 8.1 | 多平台默认 | **记住上次选择**（本机持久化，按 `userId ?? 'local'` 分 scope，与水印 preset 一致） |
| 8.2 | 智能裁剪 MVP | **接受**中心裁剪 + 预览内手动焦点（九宫格/焦点）；UI **仍称「智能裁剪」**，后续再接主体检测 |
| 8.3 | 扩图失败粒度 | **整图失败**：任一选中平台扩图失败则该队列项整体标记失败，不保留部分平台成功态（用户可整项重试） |
| 8.4 | 输出尺寸 | **严格 preset 像素**（如 1600×1600），不做「仅保比例缩放到长边」 |
| 8.5 | 与水印串联 | **预留**：未来可能「转比例 → 加水印」流水线；命名、队列 ID、中间 blob 引用需可串联（见 §7） |

## 3. 三种策略 — 实现要点

### 3.1 留白填充（M1，纯本机）

- 画布 = preset `width × height`，原图 contain 居中
- 默认背景 `#ffffff`。不透明结果输出 JPEG（quality `0.92`，与水印 worker 一致）；用户显式选透明时才输出 PNG
- 输出尺寸严格等于 preset

### 3.2 智能裁剪（M1–M2，本机）

- 画布 = preset 尺寸；原图 cover，焦点决定裁切窗口
- 焦点是整批一套设置（与水印「一次设置应用到全部」相同），不是每张图单独记。默认几何中心；九宫格对应 `(fx, fy) ∈ {0, 0.5, 1}`
- `fx/fy`：溢出量的对齐，`0` 贴起始边，`1` 贴结束边，`0.5` 居中。公式：`offset = clamp(focus * overflow, 0, overflow)`
- 文案保持「智能裁剪」。比例已与 preset 一致时，裁剪与留白结果相同（只做等比缩放）

### 3.3 智能扩展（M3，后端 Outpaint）

- **不要照搬工作站 preset 几何。** `OutpaintCanvas` 在有 preset 时用 `max(原图, preset)` 放大画布；工具箱目标尺寸永远是 preset
- 先把原图 contain 进 preset（允许放大），再只对留白条带扩图。四周都没有留白（比例已一致，含取整误差 0）则跳过模型，直接编码
- 上传给扩图的是缩放后的原图，`targetSize` = preset，`originOffset` / 蒙版里的原图矩形用缩放后的整数宽高，不用文件原始像素
- 复用 `computeOutpaintMask`、`buildOutpaintRequest`（`Capability.Outpaint`）。无 Fabric 拖框
- **失败策略（8.3）**：任一选中平台失败 → 该队列项 `failed`，错误汇总，不提供部分平台下载。整项重试会重交全部平台任务（含此前已成功的），开始前展示「图片数 × 平台数」任务数

## 4. 状态与持久化

```ts
type FitStrategy = 'letterbox' | 'crop' | 'outpaint'

interface AspectRatioSettings {
  strategy: FitStrategy // 一套策略作用于全部图片、全部已选 preset
  selectedPresetIds: string[] // 不用 platform 字符串当 key
  letterbox: { background: string } // '#ffffff' | 'transparent'
  crop: { fx: number; fy: number } // 0..1，默认 0.5 / 0.5
}

interface AspectRatioBatchItem {
  id: string
  status: 'pending' | 'processing' | 'succeeded' | 'failed' // 整项，不做部分成功
  outputs?: Record<string, Blob> // key = preset id；仅 succeeded 时齐全
  error?: string
}
```

`PLATFORM_SIZE_PRESETS` 增加稳定 `id`（现有四条可取 `amazon-main` 等）。`platform` 只用于展示。以后同一平台多规格（主图 / 详情）不会撞 key。hydrate 时丢掉已下线的 id；若一个都不剩，回退为当前字典全选。

**记住上次选择（8.1）**

- IndexedDB key 空间建议：`pixel-aigc-aspect-ratio-prefs`（或并入未来 `toolbox-shared-prefs`）
- 持久字段：`selectedPresetIds`、`strategy`、留白背景、裁剪焦点；进入页面时 hydrate，变更 debounce 写入
- 不持久化：当前队列图片列表（与水印一致，刷新清空）

**平台模板（M2，可选）**

- 与水印 preset 类似：命名保存「平台组合 + 策略 + 留白色」，与「上次选择」并存：模板应用会覆盖当前选择并写入「上次选择」

## 5. UX

- **预览**：当前图 + 切换当前平台。预览可缩小显示，但裁切/留白用同一套归一化几何，导出仍是 preset 全尺寸
- **参数**：策略 Radio；平台 Checkbox。无记录时默认全选当前 preset。一个都不选时不能开始。处理中锁定参数（同水印）
- **改设置**：策略、平台、焦点、背景色变化后作废已有输出，回到 pending（同 `invalidateBatch`）
- **队列**：处理中显示已完成平台数；结束后只有整项成功或整项失败
- **下载**：卡片下载该图全部平台（多个则打一个小 ZIP）；底部 ZIP 为全部成功图 × 平台。扁平文件名，扩展名随 MIME
- **命名**：复用水印 `outputNames` 的清洗与 `_2` 去重，后缀改为 `_{presetId}`，例如 `商品_amazon-main.jpg`

## 6. 分阶段

| 阶段 | 内容 | 后端 |
|------|------|------|
| M1 | `AspectRatioTool`、多选平台 + 记住上次、留白 + 智能裁剪（中心/焦点）、本机批量、ZIP | 无 |
| M2 | 平台模板 IndexedDB；从 watermark 抽 `toolbox/shared`（inspect、zip、限额） | 无 |
| M3 | 智能扩展：上传、Outpaint 任务、轮询；整图失败语义 | 任务 API |
| M4 | 智能裁剪主体检测；失败项跳转工作站扩图精修 | 模型 |

## 7. 与水印串联预留（8.5）

不在 M1 实现 UI，但数据结构避免死路：

- 队列项稳定 `id`（UUID），输出 blob 或 object URL 可在内存/IndexedDB 短期持有
- 导出文件名与水印后缀可组合：`{base}_{presetId}_watermarked.jpg`
- 未来「流水线」入口：将转比例 succeeded 的 `outputs` 批量注入水印队列作为 `source`，或统一 `ToolboxPipeline` 状态机（转比例 → 水印）

## 8. 目录结构（实现时）

```
src/pages/Toolbox/
  AspectRatioTool.tsx
  aspect-ratio/
    types.ts
    fitLetterbox.ts
    fitCrop.ts
    geometry.ts
    batch.ts
    download.ts
    prefs.ts          # 8.1 上次选择
    presets.ts        # M2 命名模板
  shared/             # M2 从 watermark 抽离
```

## 9. 测试重点

- 几何：各 preset 输出宽高精确等于 preset；放置矩形为整数且不越界、不留 1px 缝
- 比例已一致：裁剪与留白像素一致；扩图不发任务
- 横竖图、放大与缩小；导出 canvas 宽高等于 preset，不乘 `devicePixelRatio`
- 命名去重；prefs：刷新恢复、未知 id 丢弃、全失效时回退全选
- 改焦点/策略后已有输出作废
- outpaint（M3）：单平台失败 → 整项 failed、无部分下载；蒙版矩形用缩放后尺寸

## 10. 实现约定（补充）

这些条由现有水印/扩图代码推出来，避免 M1 和 §2 的决策打架。

| 项 | 约定 |
|----|------|
| 范围 | 一套策略 + 一套焦点作用于整批。自由尺寸仍只在图片工作站，工具箱不做自定义宽高 |
| 像素 | 原图小于 preset 时放大到 preset（8.4）。`imageSmoothingQuality = 'high'`。放大超过 2 倍时预览区提示，不拦截 |
| 方向 | 解码用 `imageOrientation: 'from-image'`（同水印）。画布重编码会去掉 EXIF |
| 格式 | 默认白底 JPEG `0.92`。仅留白且背景为透明时用 PNG。裁剪与扩图结果不透明 |
| 限额 | 源图仍走水印 `inspectImage`（20 张、单张 20MB、像素上限）。输出数 = 图片 × preset，ZIP 仍是 200MB，超出提示改逐张下 |
| 内存 | 按张串行，优先 Worker / OffscreenCanvas。预览与导出不要同时握住全部全尺寸位图 |
| 失败 | 本机编码抛错也是整项失败，与扩图同一套状态 |
| 串联 | 每个 output 带 mime、宽高，后续可包成 `File` 送进水印 `inspectImage`。M1 不做流水线 UI |
