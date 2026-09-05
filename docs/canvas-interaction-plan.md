# 图片工作站画布交互实现方案

给接手这部分开发的 agent/开发者：这份文档覆盖图片工作站里技术难度最高的两块——消除/重绘的蒙版涂抹、扩图的拖拽扩展框。目标是看完这份文档就能直接动手，不需要再回来问设计意图。

## 1. 背景与范围

图片工作站（`src/pages/ImageWorkstation/`）8 个子工具已经按 5 种交互模式分类（见 `tools.ts` 的 `InteractionMode`），目前只有 `params-only`（智能编辑/裂变/精修）和基础参数表单跑通了 UI，`mask-paint`（消除/重绘）和 `drag-resize`（扩图）两种模式的画布区目前是占位 div，本方案要把这两块补齐。

不在本次范围内：`multi-source`（融合的多图上传，纯 UI 工作量，无需 fabric.js）、`light-control`（打光的方向盘/滑块，自定义 widget，同样不需要 fabric.js）。

## 2. 现状代码上下文

以下文件已经存在，实现时要在这些文件基础上改，不要重新设计已经定好的部分。

**`src/pages/ImageWorkstation/tools.ts`** —— 工具配置表，`interactionMode` 字段已经标好每个工具用哪种交互：

```typescript
export type InteractionMode = 'params-only' | 'mask-paint' | 'drag-resize' | 'multi-source' | 'light-control'

export interface WorkstationTool {
  slug: string
  key: Capability
  label: string
  interactionMode: InteractionMode
}

export const WORKSTATION_TOOLS: WorkstationTool[] = [
  { slug: 'smart-edit', key: Capability.ImageEdit, label: '智能编辑', interactionMode: 'params-only' },
  { slug: 'relight', key: Capability.Relight, label: '重新打光', interactionMode: 'light-control' },
  { slug: 'remove', key: Capability.Inpaint, label: '消除', interactionMode: 'mask-paint' },
  { slug: 'repaint', key: Capability.Inpaint, label: '重绘', interactionMode: 'mask-paint' },
  { slug: 'variation', key: Capability.Variation, label: '裂变', interactionMode: 'params-only' },
  { slug: 'fusion', key: Capability.Fusion, label: '融合', interactionMode: 'multi-source' },
  { slug: 'outpaint', key: Capability.Outpaint, label: '扩图', interactionMode: 'drag-resize' },
  { slug: 'retouch', key: Capability.Retouch, label: '精修', interactionMode: 'params-only' },
]
```

**`src/pages/ImageWorkstation/index.tsx`** —— 页面容器，从路由 `:tool` 参数找到当前工具，渲染 `ToolSidebar` + `CanvasArea` + `ParamPanel`，底部有一个还没接逻辑的"生成"按钮。

**`src/pages/ImageWorkstation/components/CanvasArea.tsx`** —— 当前是占位组件，只根据 `interactionMode` 显示不同提示文案，没有真实交互。本方案主要改这个文件（拆成子组件）。

**`src/pages/ImageWorkstation/components/ParamPanel.tsx`** —— 目前只区分了 `Relight` 和默认两种参数表单，需要补充"重绘"模式下的文本描述框。

**`src/types/index.ts`** —— 已有 `Capability` 枚举、`ImageTaskParams`、`GenerationTask` 等类型，本方案要在此基础上扩展。

**`src/constants/platformSizes.ts`** —— `PLATFORM_SIZE_PRESETS`，扩图选预设比例时用这个。

**`src/services/api/task.ts`** —— `createTask()` 已经封装好统一的任务提交接口，生成按钮最终要调这个。

**`package.json`** —— `fabric": "^6.0.2"` 已经在依赖里，不用再装。

## 3. 总体架构：双画布叠加

```
┌───────────────────────────────┐
│ 顶层：mask canvas（fabric.js，透明背景，负责涂抹/拖拽交互） │
├───────────────────────────────┤
│ 底层：image canvas / <img>（静态展示原图，不可交互）       │
└───────────────────────────────┘
```

两层用 CSS 绝对定位叠在一起，尺寸和坐标系保持一致。导出蒙版时只导出顶层画布本身的像素数据，不涉及原图，逻辑清晰。这个架构消除/重绘和扩图共用，差别只在顶层画布里放什么交互逻辑。

**关键洞察（贯穿整个方案）**：消除/重绘（手画蒙版）和扩图（拖框算蒙版）最终都是产出同一种数据结构——`{ 原图, 黑白蒙版, 其他参数 }`。蒙版导出应该抽成一个公共工具函数（见第 7 节），两种交互复用，不要分别各写一套导出逻辑。

## 4. 类型定义变更

在 `src/types/index.ts` 中新增：

```typescript
export enum Capability {
  // ...现有的不动
  SmartSelect = 'smart_select', // 新增：智能选区，同步接口，不走生成任务队列
}

/** 消除/重绘任务参数 */
export interface InpaintTaskParams extends ImageTaskParams {
  mode: 'remove' | 'repaint'
  /** repaint 模式必填，remove 模式不需要 */
  prompt?: string
}

/** 扩图任务参数 */
export interface OutpaintTaskParams extends ImageTaskParams {
  targetSize: { width: number; height: number }
  /** 原图在目标画布中的偏移量，用于后端还原蒙版位置 */
  originOffset: { x: number; y: number }
}
```

新建 `src/pages/ImageWorkstation/utils/maskExport.ts` 里的类型：

```typescript
export interface MaskExportResult {
  /** 黑白蒙版的 dataURL：白色 = 要生成的区域，黑色 = 保留原图的区域 */
  maskDataUrl: string
  width: number
  height: number
}
```

## 5. 消除/重绘：MaskPaintCanvas 组件设计

新建 `src/pages/ImageWorkstation/components/canvas/MaskPaintCanvas.tsx`。

### 5.1 Props 与 Ref API

组件内部状态（笔刷模式、历史栈）自己管，但"导出蒙版""清空""撤销""重做"这几个动作要能被外部（`CanvasArea` 顶部工具条按钮、底部生成按钮）触发，所以用 `forwardRef` + `useImperativeHandle` 暴露命令式接口：

```typescript
interface MaskPaintCanvasProps {
  imageUrl: string
  brushSize: number
  tool: 'brush' | 'eraser'
}

export interface MaskPaintCanvasHandle {
  exportMask: () => MaskExportResult
  clear: () => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

const MaskPaintCanvas = forwardRef<MaskPaintCanvasHandle, MaskPaintCanvasProps>((props, ref) => { ... })
```

### 5.2 画笔与橡皮擦

核心是切换 `globalCompositeOperation`，这个技术方案已经用原生 canvas API 验证过效果（画笔=`source-over` 半透明红，橡皮擦=`destination-out`），fabric.js 里的写法：

```typescript
const brush = new fabric.PencilBrush(fabricCanvas)
brush.width = brushSize
fabricCanvas.freeDrawingBrush = brush
fabricCanvas.isDrawingMode = true

function applyTool(tool: 'brush' | 'eraser') {
  if (tool === 'brush') {
    fabricCanvas.freeDrawingBrush.color = 'rgba(220,38,38,0.5)'
    fabricCanvas.contextTop.globalCompositeOperation = 'source-over'
  } else {
    fabricCanvas.freeDrawingBrush.color = 'rgba(0,0,0,1)'
    fabricCanvas.contextTop.globalCompositeOperation = 'destination-out'
  }
}
```

fabric.js v6 移除了旧版的 `EraserBrush` 插件，不要尝试去装别的 eraser 插件，上面这个方案够用。

### 5.3 撤销/重做

不记录对象级别的增删，直接对整个 mask 画布做像素快照，实现和维护成本都最低：

```typescript
const history = useRef<string[]>([])
const historyIndex = useRef(-1)
const MAX_HISTORY = 20 // 超过这个数量丢弃最老的快照，避免内存无限增长

fabricCanvas.on('path:created', () => {
  const snapshot = fabricCanvas.toDataURL()
  history.current = history.current.slice(0, historyIndex.current + 1)
  history.current.push(snapshot)
  if (history.current.length > MAX_HISTORY) history.current.shift()
  historyIndex.current = history.current.length - 1
})
```

`undo`/`redo` 就是移动 `historyIndex` 并用 `fabric.Image.fromURL` 把对应快照重新画到画布上。

### 5.4 智能选区（依赖后端，先接 mock）

用户点击图片上一点 → 调 `Capability.SmartSelect` 接口 → 后端返回一个位图蒙版 → 前端把结果画到 mask 画布上、用户可以继续手动调整。

新建 `src/services/api/smartSelect.ts`：

```typescript
export interface SmartSelectPayload {
  imageUrl: string
  point: { x: number; y: number }
}

export interface SmartSelectResult {
  maskDataUrl: string
}

export function smartSelect(payload: SmartSelectPayload) {
  return apiClient.post<unknown, SmartSelectResult>('/smart-select', payload)
}
```

**后端接口还没有的情况下**，先在这个文件里用一个假实现占位（比如返回一个固定形状的蒙版），把前端交互跑通，等后端接口就绪后只需要替换函数体，UI 侧不用改：

```typescript
export function smartSelect(payload: SmartSelectPayload): Promise<SmartSelectResult> {
  // TODO: 替换成真实接口 apiClient.post('/smart-select', payload)
  return Promise.resolve({ maskDataUrl: MOCK_CIRCLE_MASK_DATA_URL })
}
```

### 5.5 与 ParamPanel 的联动

"重绘"比"消除"多一个文本描述框。`ParamPanel.tsx` 需要能区分这两个 slug（不能只判断 `Capability`，因为消除和重绘共用 `Capability.Inpaint`），建议给 `ParamPanel` 加一个 `mode?: 'remove' | 'repaint'` prop，由 `ImageWorkstation/index.tsx` 根据 `activeTool.slug` 传入：

```typescript
const inpaintMode = activeTool.slug === 'repaint' ? 'repaint' : activeTool.slug === 'remove' ? 'remove' : undefined
<ParamPanel capability={activeTool.key} mode={inpaintMode} />
```

`ParamPanel` 里 `mode === 'repaint'` 时渲染一个 `Input.TextArea` 描述框，`mode === 'remove'` 时不渲染。

## 6. 扩图：OutpaintCanvas 组件设计

新建 `src/pages/ImageWorkstation/components/canvas/OutpaintCanvas.tsx`。

### 6.1 Props 与 Ref API

```typescript
interface OutpaintCanvasProps {
  imageUrl: string
  imageNaturalSize: { width: number; height: number }
  /** 选中平台预设时传入目标尺寸，为空则是自由拖拽模式 */
  presetTargetSize?: { width: number; height: number }
}

export interface OutpaintCanvasHandle {
  exportMask: () => MaskExportResult
  getTargetSize: () => { width: number; height: number }
  getOriginOffset: () => { x: number; y: number }
}
```

### 6.2 交互实现要点

- 原图作为一个**锁定的** `fabric.Image`（`selectable: false`，位置固定），扩展边界用一个 `fabric.Rect` 表示，允许拖拽四角/四边缩放，但要限制其**不能缩小到比原图还小**（用 `object:scaling` 事件里做边界检查，`scaleX/scaleY` 不能让 rect 宽高小于原图宽高）
- 扩展出来的区域（rect 范围减去原图范围）要有视觉提示——半透明遮罩或斜线填充，让用户明确知道"这块 AI 会生成内容"
- 选平台预设比例时（下拉框选项来自 `PLATFORM_SIZE_PRESETS`），不走手动拖拽，直接计算目标宽高、把原图居中对齐，程序化设置 rect 的宽高和原图的 `left/top`
- 蒙版计算是纯几何运算，不需要用户手画：

```typescript
function computeOutpaintMask(
  targetSize: { width: number; height: number },
  originOffset: { x: number; y: number },
  imageNaturalSize: { width: number; height: number },
): MaskExportResult {
  const canvas = document.createElement('canvas')
  canvas.width = targetSize.width
  canvas.height = targetSize.height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff' // 白色 = 待生成区域，先铺满
  ctx.fillRect(0, 0, targetSize.width, targetSize.height)
  ctx.fillStyle = '#000000' // 黑色 = 保留原图区域
  ctx.fillRect(originOffset.x, originOffset.y, imageNaturalSize.width, imageNaturalSize.height)
  return { maskDataUrl: canvas.toDataURL(), width: targetSize.width, height: targetSize.height }
}
```

这个函数放进第 7 节的公共工具文件里，和手画蒙版的导出函数放在一起，接口形状保持一致（都返回 `MaskExportResult`），上层调用方不用关心蒙版是画出来的还是算出来的。

## 7. 公共工具：`src/pages/ImageWorkstation/utils/maskExport.ts`

```typescript
export interface MaskExportResult {
  maskDataUrl: string
  width: number
  height: number
}

/** 消除/重绘用：直接导出 mask 画布本身的像素 */
export function exportPaintedMask(maskCanvasEl: HTMLCanvasElement): MaskExportResult {
  return {
    maskDataUrl: maskCanvasEl.toDataURL(),
    width: maskCanvasEl.width,
    height: maskCanvasEl.height,
  }
}

/** 扩图用：根据几何位置计算蒙版，实现见第 6.2 节 computeOutpaintMask */
export function computeOutpaintMask(
  targetSize: { width: number; height: number },
  originOffset: { x: number; y: number },
  imageNaturalSize: { width: number; height: number },
): MaskExportResult {
  /* ...同 6.2 节代码... */
}
```

## 8. `CanvasArea.tsx` 整合改造

现有的 `CanvasArea` 按 `interactionMode` 分支显示提示文案，改造后按 `interactionMode` 分支渲染对应的真实组件，并把子组件的 ref 往上传给父级（`ImageWorkstation/index.tsx` 的生成按钮需要用到）：

```typescript
interface CanvasAreaProps {
  interactionMode: InteractionMode
  imageUrl: string
  inpaintMode?: 'remove' | 'repaint'
  onReady: (handle: MaskPaintCanvasHandle | OutpaintCanvasHandle | null) => void
}

export default function CanvasArea({ interactionMode, imageUrl, onReady }: CanvasAreaProps) {
  if (interactionMode === 'mask-paint') {
    return <MaskPaintCanvas ref={onReady} imageUrl={imageUrl} brushSize={brushSize} tool={tool} />
  }
  if (interactionMode === 'drag-resize') {
    return <OutpaintCanvas ref={onReady} imageUrl={imageUrl} imageNaturalSize={naturalSize} presetTargetSize={presetSize} />
  }
  // params-only / multi-source / light-control 维持原有占位或各自的实现
}
```

蒙版涂抹的画笔工具条（笔刷大小滑块、画笔/橡皮擦切换、智能选区按钮、撤销重做、清空）建议做成独立的 `BrushToolbar.tsx`，浮在 `CanvasArea` 顶部或底部，只在 `interactionMode === 'mask-paint'` 时渲染。

## 9. `ImageWorkstation/index.tsx` 整合改造

"生成"按钮目前是纯 UI，改造后要：

1. 从 `CanvasArea` 拿到当前 `MaskPaintCanvasHandle` 或 `OutpaintCanvasHandle` 的 ref
2. 点击时调用 `handle.exportMask()` 拿到 `MaskExportResult`
3. 组装成 `InpaintTaskParams` 或 `OutpaintTaskParams`，调用 `src/services/api/task.ts` 的 `createTask()`
4. 拿到返回的 `taskId` 后，用 `useTaskPolling(taskId)`（已存在的 hook，`src/hooks/useTaskPolling.ts`）轮询状态，完成/失败会自动弹全局通知（这部分已经在之前的脚手架完善里接好了，不用重新做）

```typescript
async function handleGenerate() {
  if (!canvasHandleRef.current) return
  const mask = canvasHandleRef.current.exportMask()
  const task = await createTask({
    capability: activeTool.key,
    requestId: crypto.randomUUID(),
    params: {
      sourceImageUrl: currentImageUrl,
      maskUrl: mask.maskDataUrl, // 实际生产环境这里要先上传到对象存储换成 URL，不能直接传 dataURL
      mode: inpaintMode,
      prompt: repaintPrompt,
    },
  })
  setActiveTaskId(task.id)
}
```

**注意**：`maskDataUrl` 是本地 base64，真实环境不能直接传给后端，要先调 `src/services/api/upload.ts`（这个文件当前还不存在，需要新建，参考架构文档里"对象存储直传"的设计）上传成 URL 再传给 `createTask`。如果 upload 接口还没好，先用 dataURL 占位跑通前端交互，明确标记 TODO。

## 10. `ParamPanel.tsx` 改造

- `mode === 'repaint'` 时增加 `Input.TextArea` 描述框（见 5.5 节）
- `capability === Capability.Outpaint` 时增加：目标平台下拉（数据源 `PLATFORM_SIZE_PRESETS`）+ 自由拖拽/预设比例切换开关
- 其余工具的参数表单维持现状

## 11. 新增/修改文件清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `src/pages/ImageWorkstation/components/canvas/MaskPaintCanvas.tsx` | 新建 | 消除/重绘蒙版画布 |
| `src/pages/ImageWorkstation/components/canvas/OutpaintCanvas.tsx` | 新建 | 扩图拖拽扩展框 |
| `src/pages/ImageWorkstation/components/canvas/BrushToolbar.tsx` | 新建 | 画笔工具条 UI |
| `src/pages/ImageWorkstation/utils/maskExport.ts` | 新建 | 蒙版导出公共工具 |
| `src/services/api/smartSelect.ts` | 新建 | 智能选区接口（先 mock） |
| `src/services/api/upload.ts` | 新建 | 对象存储直传封装 |
| `src/pages/ImageWorkstation/components/CanvasArea.tsx` | 修改 | 按交互模式渲染真实组件 |
| `src/pages/ImageWorkstation/components/ParamPanel.tsx` | 修改 | 加重绘描述框、扩图平台预设 |
| `src/pages/ImageWorkstation/index.tsx` | 修改 | 生成按钮接入 `createTask` |
| `src/types/index.ts` | 修改 | 加 `SmartSelect` capability、`InpaintTaskParams`、`OutpaintTaskParams` |

## 12. 建议实施顺序

1. `types/index.ts` 类型先行
2. `utils/maskExport.ts`（先写 `computeOutpaintMask`，纯函数容易测）
3. `MaskPaintCanvas.tsx`（画笔 + 橡皮擦 + 撤销重做，先不做智能选区）
4. `BrushToolbar.tsx` + 接入 `CanvasArea.tsx`，此时消除/重绘应该已经可以手动涂抹并导出蒙版
5. `smartSelect.ts`（mock 实现）+ 接入智能选区按钮
6. `OutpaintCanvas.tsx`（先做自由拖拽，再做平台预设联动）
7. `ParamPanel.tsx` 改造（重绘描述框、扩图平台选择）
8. `ImageWorkstation/index.tsx` 生成按钮接入 `createTask` + `useTaskPolling`
9. `upload.ts`（如果后端对象存储接口已就绪）

## 13. 验收标准

- [ ] 消除模式：能涂抹、能擦除、能撤销/重做、点生成能导出正确的黑白蒙版（白=涂抹区域）
- [ ] 重绘模式：在消除的基础上，能填写描述文本，生成参数里带上 `prompt`
- [ ] 智能选区：点击图片上一点，mock 蒙版能正确画到画布上，且用户能在此基础上继续手动涂抹调整
- [ ] 扩图：拖拽扩展框能自由缩放且不能缩小到比原图小；选平台预设能自动居中对齐；导出的蒙版几何位置正确（用几张不同宽高比的图测试）
- [ ] 撤销栈上限生效（连续涂抹 25+ 笔不应导致内存持续增长）
- [ ] 移动端触屏也能正常涂抹（`touch-action: none` 别漏加）
- [ ] 生成按钮点击后任务状态能通过已有的 `useTaskPolling` 正确轮询并弹出完成/失败通知

## 14. 已知依赖与开放问题

- **`Capability.SmartSelect` 后端接口尚未实现**，本方案已经设计了 mock 降级路径，后端就绪后只需替换 `smartSelect.ts` 的函数体
- **对象存储直传接口（`upload.ts`）尚未实现**，蒙版和图片目前只能传 dataURL，生产环境必须换成先上传拿 URL 的流程，否则请求体过大
- **`Capability.Inpaint`/`Capability.Outpaint` 的真实 Provider 对接**（通义万相/自研模型等）在后端，不在本方案范围内，前端只需要保证 `createTask` 传参格式正确
- **融合（multi-source）和打光（light-control）两种交互模式不在本方案覆盖范围**，需要另开方案
