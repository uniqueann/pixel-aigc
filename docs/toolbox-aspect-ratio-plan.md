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

- 画布 = preset `width × height`
- 原图 `object-fit: contain` 居中，其余区域填充（色值可配置，PNG 可透明）
- 输出尺寸严格等于 preset

### 3.2 智能裁剪（M1–M2，本机）

- 画布 = preset 尺寸；原图 `object-fit: cover`，裁切中心由 **焦点** 决定
- 默认焦点：几何中心；预览可改九宫格锚点或归一化 `(fx, fy)`
- 文案保持「智能裁剪」，不暗示 MVP 已接主体检测

### 3.3 智能扩展（M3，后端 Outpaint）

- 原图完整保留在 preset 画布内（居中，与工作站扩图 preset 几何一致）
- 复用 `computeOutpaintMask`、`buildOutpaintRequest`（`Capability.Outpaint`）
- 批量无 Fabric 拖框：固定 preset 居中扩图几何
- **失败策略（8.3）**：该图所有平台任务中若任一扩图失败 → 队列项 `failed`，错误信息汇总；不导出该平台单独成功文件（整项重试）

## 4. 状态与持久化

```ts
type FitStrategy = 'letterbox' | 'crop' | 'outpaint'

interface AspectRatioSettings {
  strategy: FitStrategy
  selectedPlatforms: string[] // preset.platform
  letterbox: { background: string }
  crop: { focus: Anchor | 'custom'; custom?: { x: number; y: number } }
}

// 队列项：扩图/多平台时
interface AspectRatioBatchItem {
  id: string
  // 本机策略下 outputs[preset.platform] = blob
  // outpaint 策略：处理中挂 taskIds，成功后再写 outputs；任一失败 → item.status = 'failed'
}
```

**记住上次选择（8.1）**

- IndexedDB key 空间建议：`pixel-aigc-aspect-ratio-prefs`（或并入未来 `toolbox-shared-prefs`）
- 持久字段：`selectedPlatforms`、`strategy`、留白色、裁剪焦点；进入页面时 hydrate，变更 debounce 写入
- 不持久化：当前队列图片列表（与水印一致，刷新清空）

**平台模板（M2，可选）**

- 与水印 preset 类似：命名保存「平台组合 + 策略 + 留白色」，与「上次选择」并存：模板应用会覆盖当前选择并写入「上次选择」

## 5. UX

- **预览**：当前选中图 + 下拉/Segmented 切换「当前预览的平台 preset」
- **参数**：策略 Radio；平台 Checkbox（初始值 = 上次选择）；crop 时显示焦点控件
- **队列卡片**：
  - letterbox/crop：显示「已完成 N/M 平台」或全部 succeeded
  - outpaint：处理中显示进度；失败显示整图失败原因（8.3）
- **下载命名**：`{basename}_{platform}.jpg`（严格尺寸后缀可选，如 `_amazon_1600x1600` 与 preset 一致即可）
- **ZIP**：扁平或 `{basename}/{platform}.jpg` 二选一（实现时与水印 ZIP 风格统一）

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
- 导出文件名规则与水印 `_watermarked` 后缀可组合：`{base}_{platform}_watermarked.jpg`
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

- 几何：各 preset 下 contain/cover 输出 **精确** width×height（8.4）
- 横竖图混合批量；平台多选笛卡尔积命名不冲突
- prefs：切换 scope、刷新后平台选择与策略恢复
- outpaint（M3）：模拟单平台失败 → 整项 failed，无部分下载
