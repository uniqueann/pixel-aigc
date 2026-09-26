# 工具箱 · 转比例 — 开发规划

> 与 [`architecture.md`](./architecture.md) §6 对齐。加水印批量链路已落地，转比例复用同一套工具箱骨架。

## 1. 目标

电商运营将同一张商品图批量转换为指定平台规格（见 `src/constants/platformSizes.ts`），支持三种适配策略，批量本机队列 + 可选 AI 扩图，输出可逐张或 ZIP 打包。

| 能力 | 说明 |
|------|------|
| 单选目标平台 | 一次只能勾选一个目标平台 preset（Radio / Select），每张原图对应输出 1 份结果 |
| 适配策略 | 留白填充 / **智能裁剪** / 智能扩展（复用扩图 Capability） |
| 批量 | 与水印一致：最多 20 张、JPG/PNG/WebP、队列预览与逐张/ZIP 下载 |
| 路由 | `/toolbox/aspect-ratio`，独立 `AspectRatioTool`（lazy），入口在 `Toolbox/index.tsx` |

## 2. 已锁定产品决策

| # | 议题 | 决策 |
|---|------|------|
| 8.1 | 目标平台默认 | **单选平台，记住上次选择**（本机持久化，按 `userId ?? 'local'` 分 scope，初次进入默认第 1 个 preset） |
| 8.2 | 智能裁剪 MVP | **接受**中心裁剪 + 预览内手动焦点（九宫格/焦点）；UI **仍称「智能裁剪」**，后续再接主体检测 |
| 8.3 | 扩图失败粒度 | **整图失败**：该图扩图失败则该队列项标记失败（可单张或批量重试） |
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
- **Outpaint 提示词与参数**：转比例场景下扩图是结构性补全，默认传空或通用背景延续提示词（由后端 capability 处理延伸），不需要向用户暴露复杂画笔与提示词输入，保持批处理工具的轻量
- **失败策略（8.3）**：扩图失败 → 该队列项 `failed`，展示失败原因。用户可单项重试或整批重试失败项
- **轮询与并发管控**：多张图批量任务避免全部瞬间提交打满限流，设置并发工作池（限制如 2~3 个任务并发执行），采用批量轮询器推进队列状态

## 4. 状态与持久化

```ts
type FitStrategy = 'letterbox' | 'crop' | 'outpaint'

interface AspectRatioSettings {
  strategy: FitStrategy // 一套策略作用于全部图片
  selectedPresetId: string // 单选目标平台 preset id
  letterbox: { background: string } // '#ffffff' | 'transparent'
  crop: { fx: number; fy: number } // 0..1，默认 0.5 / 0.5
}

interface AspectRatioBatchItem {
  id: string
  file: File
  sourceMime: 'image/jpeg' | 'image/png' | 'image/webp'
  sourceUrl: string
  width: number
  height: number
  status: 'pending' | 'processing' | 'succeeded' | 'failed'
  output?: Blob
  outputMime?: string
  error?: string
}
```

`PLATFORM_SIZE_PRESETS` 增加稳定 `id`（现有四条可取 `amazon-main` 等）。`platform` 用于展示。单选模式下，每个队列项直接产出单一输出 `output`，结构与水印 `BatchImage` 保持 1:1 对齐，极大降低数据模型复杂度。

**记住上次选择（8.1）**

- IndexedDB key 空间建议：`pixel-aigc-aspect-ratio-prefs`
- 持久字段：`selectedPresetId`、`strategy`、留白背景、裁剪焦点；进入页面时 hydrate，变更 debounce 写入
- 不持久化：当前队列图片列表（与水印一致，刷新清空）

**平台模板（M2，可选）**

- 命名保存「常用目标平台 + 适配策略 + 留白色」，方便常用工作流一键载入

## 5. UX

- **预览**：当前选中图在目标平台尺寸下的实时预览效果。预览区使用降采样渲染，但使用统一几何计算
- **参数**：
  - 目标平台：单选（Radio.Group 或卡片式单选），列出平台名称与尺寸（如 Amazon 主图 1600×1600）
  - 适配策略：Radio（留白填充 / 智能裁剪 / 智能扩展）
  - 对应子参数：留白显示背景色选择；裁剪显示九宫格/焦点控制器
  - 处理中锁定参数输入
- **改设置**：策略、目标平台、焦点、背景色变化后作废已有输出，回到 pending（同 `invalidateBatch`）
- **队列**：单选平台后，每张图输出 1 个目标结果，卡片状态为待处理 / 处理中 / 已完成 / 失败，支持单张下载、单张重试、整批重试失败项
- **下载**：单张下载直接保存该图；底部打包下载导出整批已成功的 ZIP
- **命名**：复用水印 `outputNames` 的清洗与 `_2` 去重，后缀改为 `_{presetId}`，例如 `商品_amazon-main.jpg`

## 6. 分阶段

| 阶段 | 内容 | 状态 |
|------|------|------|
| M1 | `AspectRatioTool`、单选目标平台 + 记住上次选择、留白 + 智能裁剪（中心/焦点）、本机批量、ZIP | 已落地 |
| M2 | 常用模板 IndexedDB；从 watermark 抽离 `toolbox/shared` 通用组件（inspect、zip、限额） | 已落地 |
| M3 | 智能扩展：比例一致时本机缩放；需要补边时提交 `Capability.Outpaint`，同时最多 3 个。真实模式会拒绝该能力。失败项可带到工作站按当前平台尺寸精修 | 前端已落地，真实扩图供应商未接 |
| M4 | 焦点换算和固定模拟框已落地，页面保留「模拟未找到主体」。真实检测见 [`toolbox-subject-detect-todo.md`](./toolbox-subject-detect-todo.md) | 真实接口未接 |

## 7. 与水印串联预留（8.5）

流水线入口还没有。数据结构保持可串联：

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
- 命名去重；prefs：刷新恢复上次选中平台与策略、未知 id 丢弃并回退到默认第 1 个 preset
- 改焦点/策略/目标平台后已有输出作废
- 批量轮询与并发限制：并发池不溢出最大限制（2~3 并发）
- 预览性能：切换单选平台或选中图片时只计算缩放预览尺寸，不生成全尺寸高清大图
- outpaint（M3）：失败项标记与重试；蒙版矩形用缩放后尺寸

## 10. 实现约定（补充）

这些条由现有水印/扩图代码推出来，避免 M1 和 §2 的决策打架。

| 项 | 约定 |
|----|------|
| 范围 | 一次单选一个目标平台。一套策略 + 一套焦点作用于整批。自由尺寸仍只在图片工作站，工具箱不做自定义宽高 |
| 像素 | 原图小于 preset 时放大到 preset（8.4）。`imageSmoothingQuality = 'high'`。放大超过 2 倍时预览区提示，不拦截 |
| 方向 | 解码用 `imageOrientation: 'from-image'`（同水印）。画布重编码会去掉 EXIF |
| 格式 | 默认白底 JPEG `0.92`。仅留白且背景为透明时用 PNG。裁剪与扩图结果不透明 |
| 限额 | 源图仍走水印 `inspectImage`（20 张、单张 20MB、像素上限）。单选平台输出数为 1:1（20 张对应 20 份结果），ZIP 仍是 200MB，超出提示改逐张下 |
| 内存 | 按张串行，优先 Worker / OffscreenCanvas。预览与导出不要同时握住全部全尺寸位图 |
| 预览尺寸 | 预览区使用降采样渲染（如设置 `previewMaxDimension: 800`，类似水印 Worker），避免 4K/2K 大原图或大 preset 直接跑全尺寸 Canvas 导致主线程/Worker 交互卡顿 |
| 失败 | 本机编码抛错也是整项失败，与扩图同一套状态 |
| 串联 | 每个 output 带 mime、宽高，后续可包成 `File` 送进水印 `inspectImage`。M1 不做流水线 UI |
| 批量重试 | 支持整批「重试失败项」，仅对状态为 `failed` 的条目重新发起转比例处理，而不需要用户重新清空队列或全选重新执行 |
