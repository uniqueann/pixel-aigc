# Stage 3 · 编辑器架构实现方案

给接手这部分开发的 agent/开发者：这份文档覆盖 Stage 3——把 Stage 2 交付的独立交互原型（消除/重绘的蒙版画布、扩图的拖拽扩展框）收编进一套统一的编辑器内核。Stage 3 不是纯增量开发，包含对已有代码的重构，方案里会明确标出哪些是新建、哪些是改造。

## 0. 重要前提：先核实现状

Stage 2 的实际代码是由另一个 agent 按 `docs/canvas-interaction-plan.md` 的约定实现的，本方案假设该文档里定义的接口（`MaskPaintCanvasHandle`、`OutpaintCanvasHandle`、`exportMask()`、`CanvasArea` 按 `interactionMode` 分支渲染等）已经落地。**开始改造前务必先读一遍实际代码，核实这些接口是否和文档一致**，如果实际实现有出入，以实际代码为准，必要时回来更新这份方案里引用的签名。

**具体建议**：正式动手前，先贴出以下四个文件的完整代码核对一遍，不要只凭 README 里的完成状态摘要就直接开始重构：

- `src/pages/ImageWorkstation/components/CanvasArea.tsx`
- `src/pages/ImageWorkstation/components/canvas/MaskPaintCanvas.tsx`
- `src/pages/ImageWorkstation/components/canvas/OutpaintCanvas.tsx`
- `src/types/index.ts`

重点核对：`MaskPaintCanvasHandle`/`OutpaintCanvasHandle` 的方法签名是否和 `canvas-interaction-plan.md` 第 5.1/6.1 节一致、`exportMask`/`exportResult` 的返回值结构是否为 `{ maskDataUrl, width, height }`、笔画撤销的历史栈实现方式（是否真的是 dataURL 快照，还是改成了别的方案）。这几点直接决定第 3.4 节"改造 Stage 2 已有组件"能不能按现在写的方式进行。

## 1. 背景与目标

现状问题：`MaskPaintCanvas`、`OutpaintCanvas` 各自在组件内部创建和销毁自己的 `fabric.Canvas` 实例，工具之间没有共享状态——切换工具时不知道"当前处理的是同一张图的哪个版本"，也没有跨工具的撤销重做（只有 `MaskPaintCanvas` 内部的笔画级撤销）。

Stage 3 要交付三块东西：

1. **文档状态模型**——统一的"当前编辑会话在处理什么"
2. **画布引擎 + 工具注册表**——共享的 fabric.Canvas 生命周期管理，工具变成可插拔的插件
3. **历史 / 版本树**——跨工具、跨生成动作的版本回溯，区别于 mask 画布内部的笔画撤销

三者的依赖关系：文档状态模型是地基，引擎+工具注册在其上运行，版本树依赖前两者定好的数据结构。**建议按这个顺序实现**。

## 2. 模块一：文档状态模型

新建 `src/store/useEditorDocument.ts`，风格上和已有的 `useTaskStore.ts`/`useUserStore.ts` 保持一致（zustand，不用额外引入状态管理库）。

```typescript
export interface EditorDocument {
  documentId: string
  originalImageUrl: string
  /** 当前工作图：可能等于 originalImageUrl，也可能是上一次生成的结果 */
  currentImageUrl: string
  naturalSize: { width: number; height: number }
  lastGeneratedTaskId: string | null
}

interface EditorDocumentState {
  document: EditorDocument | null
  loadDocument: (originalImageUrl: string, naturalSize: { width: number; height: number }) => void
  setCurrentImage: (url: string) => void
  reset: () => void
}

export const useEditorDocument = create<EditorDocumentState>((set) => ({
  document: null,
  loadDocument: (originalImageUrl, naturalSize) =>
    set({
      document: {
        documentId: crypto.randomUUID(),
        originalImageUrl,
        currentImageUrl: originalImageUrl,
        naturalSize,
        lastGeneratedTaskId: null,
      },
    }),
  setCurrentImage: (url) =>
    set((s) => (s.document ? { document: { ...s.document, currentImageUrl: url } } : s)),
  reset: () => set({ document: null }),
}))
```

**关键点**：这是一个 zustand store（模块级单例），不是 React 组件内的 `useState`。路由结构里 `/image-workstation/:tool` 切换 `:tool` 参数时，`ImageWorkstation` 组件的 `useParams()` 会变但组件实例不会重新挂载（同一个路由元素），zustand store 的数据本来就不受组件重渲染影响——所以只要在合适的时机调用一次 `loadDocument`（用户上传图片时），后续在 `remove`/`repaint`/`outpaint` 之间切换，`document.currentImageUrl` 会保持一致，不会因为切工具而丢失。

## 3. 模块二：画布引擎 + 工具注册表

### 3.1 共享画布引擎

新建 `src/pages/ImageWorkstation/engine/useCanvasEngine.ts`：

```typescript
interface CanvasEngineOptions {
  containerEl: HTMLDivElement
  width: number
  height: number
}

export interface CanvasEngineHandle {
  canvas: fabric.Canvas
  zoomTo: (scale: number) => void
  fitToScreen: () => void
  screenToCanvasPoint: (x: number, y: number) => { x: number; y: number }
  dispose: () => void
}

export function useCanvasEngine(options: CanvasEngineOptions | null): CanvasEngineHandle | null {
  // 只在 options 变化（容器/尺寸变化）时重新创建 fabric.Canvas，
  // 工具切换本身不应该触发这里的重建
}
```

这个 hook 只在 `CanvasArea` 里调用**一次**，不是每个工具组件各自调用。

### 3.2 工具插件接口

新建 `src/pages/ImageWorkstation/engine/types.ts`：

```typescript
import type { InteractionMode } from '../tools'
import type { MaskExportResult } from '../utils/maskExport'

export interface ToolMountContext {
  imageUrl: string
  naturalSize: { width: number; height: number }
  /** 工具自己的运行时参数，比如画笔大小、目标扩图尺寸 */
  params: Record<string, unknown>
}

export interface EditorToolPlugin {
  slug: string
  interactionMode: InteractionMode
  /** 把工具的交互逻辑挂载到共享引擎上，返回卸载函数 */
  mount: (engine: CanvasEngineHandle, ctx: ToolMountContext) => () => void
  /** 导出当前结果，供生成按钮调用 */
  exportResult: () => MaskExportResult
}
```

### 3.3 工具注册表

新建 `src/pages/ImageWorkstation/engine/toolRegistry.ts`：

```typescript
export const TOOL_PLUGINS: Record<string, EditorToolPlugin> = {
  remove: maskPaintPlugin,
  repaint: maskPaintPlugin,
  outpaint: outpaintPlugin,
  // fusion / light-control 对应的插件还没实现，先不注册，
  // CanvasArea 对这两种 interactionMode 维持 Stage 2 的占位逻辑
}
```

这一层的思路和后端 Provider 抽象层是一回事——`CanvasArea` 不关心具体是哪个工具，只关心"当前 slug 对应哪个插件、往引擎上挂什么"。以后加融合、打光，或者任何新工具，只需要新写一个 plugin 塞进这个表，不用改 `CanvasArea` 本身。

### 3.4 改造 Stage 2 已有组件

`MaskPaintCanvas.tsx` 和 `OutpaintCanvas.tsx` 现有的画笔/橡皮擦/撤销重做/拖拽扩展框逻辑（`canvas-interaction-plan.md` 第 5、6 节）**不用重写**，改造点是：

- 删掉组件内部 `new fabric.Canvas(...)` 的创建逻辑，改成接收外部传入的 `CanvasEngineHandle`
- 原来的 `MaskPaintCanvasHandle`/`OutpaintCanvasHandle`（`exportMask`/`clear`/`undo`/`redo`）保留，但从"组件 ref 暴露的命令式接口"改造成"插件对象的方法"，即 `EditorToolPlugin.exportResult` 内部调用原来的 `exportMask` 逻辑
- 笔画级撤销/重做（第 5.3 节的 history 快照栈）**留在插件内部**，不要和第 4 节的版本树混在一起，两者粒度不同（见第 4.3 节说明）

### 3.5 改造 `CanvasArea.tsx`

从"按 `interactionMode` 分支渲染不同组件"改成"托管一个引擎实例 + 按需挂载插件"：

```typescript
export default function CanvasArea({ toolSlug, imageUrl, naturalSize, params }: CanvasAreaProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const engine = useCanvasEngine(containerRef.current ? { containerEl: containerRef.current, width, height } : null)
  const exportRef = useRef<(() => MaskExportResult) | null>(null)

  useEffect(() => {
    if (!engine) return
    const plugin = TOOL_PLUGINS[toolSlug]
    if (!plugin) return
    const unmount = plugin.mount(engine, { imageUrl, naturalSize, params })
    exportRef.current = plugin.exportResult
    return unmount // 切换工具时只卸载插件，不销毁 engine
  }, [engine, toolSlug, imageUrl])

  // ...
}
```

`engine` 的创建只依赖容器和尺寸，工具切换只触发插件的 mount/unmount，fabric.Canvas 本身全程只创建一次——这是 Stage 3 相对 Stage 2 最大的行为差异，也是后面版本树能正常工作的前提（如果每次切工具都整个重建画布，画布本身持有的状态没法参与版本管理）。

## 4. 模块三：历史 / 版本树

### 4.1 数据结构

新建 `src/store/useEditVersionTree.ts`：

```typescript
export interface EditVersionNode {
  id: string
  parentId: string | null
  toolSlug: string
  imageUrl: string
  taskId?: string
  createdAt: string
}

interface VersionTreeState {
  nodes: Record<string, EditVersionNode>
  currentNodeId: string | null
  rootNodeId: string | null
  initRoot: (imageUrl: string) => void
  addVersion: (input: { toolSlug: string; imageUrl: string; taskId?: string }) => string
  goToVersion: (nodeId: string) => void
  getPathToRoot: (nodeId: string) => EditVersionNode[]
}
```

**是树不是栈**：架构文档里明确要求"支持回退到任意历史版本继续编辑，而非简单覆盖"——用户回到某个历史版本后再发起新的编辑，应该从那个节点分叉出一条新分支，而不是覆盖掉之后的版本。所以 `parentId` 是必须的，不能用简单的数组栈实现。

### 4.2 什么时候写入版本节点

只有**调用 `createTask` 并成功拿到结果**才算一个版本节点，纯本地涂抹/拖拽过程（用户还没点"生成"）不算版本。在 `ImageWorkstation/index.tsx` 的生成按钮逻辑（`canvas-interaction-plan.md` 第 9 节）里，`useTaskPolling` 检测到任务 `succeeded` 时：

```typescript
addVersion({ toolSlug: activeTool.slug, imageUrl: task.resultUrls![0], taskId: task.id })
setCurrentImage(task.resultUrls![0]) // 更新文档状态模型的 currentImageUrl
```

### 4.3 和 Stage 2 局部撤销的关系（容易混淆，务必区分）

两层历史粒度不同，**不要合并成一套**：

| | 笔画级撤销（Stage 2 已有） | 版本树（Stage 3 新增） |
|---|---|---|
| 粒度 | 一次画笔/橡皮擦操作 | 一次成功的生成任务 |
| 存在位置 | 各工具插件内部（`MaskPaintCanvas` 的 history 栈） | 全局 `useEditVersionTree` |
| 用途 | "这笔画错了，退一步" | "这版效果不满意，回到消除之前重新扩图" |
| 触发时机 | 每次 `path:created` | 每次生成任务成功 |

### 4.4 历史面板 UI

新建 `src/pages/ImageWorkstation/components/HistoryPanel.tsx`，替换掉 `ImageWorkstation/index.tsx` 底部那个"历史版本"文字占位（`canvas-interaction-plan.md` 遗留的 TODO）。展示版本树的缩略图列表，点击某个节点调用 `goToVersion`，同步更新 `useEditorDocument` 的 `currentImageUrl`。

## 5. 新增/修改文件清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `src/store/useEditorDocument.ts` | 新建 | 文档状态模型 |
| `src/store/useEditVersionTree.ts` | 新建 | 版本树状态 |
| `src/pages/ImageWorkstation/engine/useCanvasEngine.ts` | 新建 | 共享画布引擎 |
| `src/pages/ImageWorkstation/engine/types.ts` | 新建 | `EditorToolPlugin` 等类型 |
| `src/pages/ImageWorkstation/engine/toolRegistry.ts` | 新建 | 工具插件注册表 |
| `src/pages/ImageWorkstation/components/canvas/MaskPaintCanvas.tsx` | 重构 | 改造成插件，画笔/橡皮擦/局部撤销逻辑不变 |
| `src/pages/ImageWorkstation/components/canvas/OutpaintCanvas.tsx` | 重构 | 同上 |
| `src/pages/ImageWorkstation/components/CanvasArea.tsx` | 重构 | 托管唯一引擎实例，按需挂载/卸载插件 |
| `src/pages/ImageWorkstation/components/HistoryPanel.tsx` | 新建 | 版本树 UI，替换原有占位文字 |
| `src/pages/ImageWorkstation/index.tsx` | 修改 | 接入文档状态、生成成功后写入版本节点 |

## 6. 建议实施顺序

1. `useEditorDocument.ts`（地基，先跑通"上传图片后跨工具切换不丢状态"）
2. `engine/types.ts` + `useCanvasEngine.ts`（先写好引擎骨架，可以先用一个空插件验证生命周期正确）
3. 把 `MaskPaintCanvas.tsx` 改造成插件接入引擎，此时应该能验证"切到扩图再切回消除，蒙版画布没有被销毁重建"
4. `OutpaintCanvas.tsx` 同样改造，`toolRegistry.ts` 补全
5. `useEditVersionTree.ts` + `HistoryPanel.tsx`
6. `ImageWorkstation/index.tsx` 收尾：生成成功回调里接入版本节点写入

## 7. 验收标准

- [ ] 在消除 → 扩图 → 重绘之间切换工具，`fabric.Canvas` 只被创建一次（可以在 `useCanvasEngine` 里加个创建计数验证）
- [ ] 切换工具过程中 `useEditorDocument` 的 `currentImageUrl` 保持不变，不会被重置
- [ ] 消除模式下的笔画撤销/重做（Ctrl+Z 体验）改造后依然正常工作
- [ ] 连续两次生成成功后，版本树有两个节点且 `parentId` 关系正确；回到第一个节点后发起新的生成，产生的是新分支而不是覆盖第二个节点
- [ ] 历史面板点击任意版本，画布正确回显对应版本的图片
- [ ] 离开 `/image-workstation` 路由时，`fabric.Canvas` 被正确 `dispose`，多次进出页面不会有内存持续增长（用浏览器 Performance/Memory 面板验证）

项目已经引入 `vitest`，以下几块是纯逻辑、不依赖真实 DOM/Canvas 渲染，适合补单测，而不是全靠手动验证：

- [ ] `useCanvasEngine` 的创建/销毁逻辑有单测覆盖（mock `fabric.Canvas`，验证 `dispose` 在 unmount 时被正确调用、options 不变时不会重复创建）
- [ ] `useEditVersionTree` 的 `addVersion`/`goToVersion`/`getPathToRoot` 有单测覆盖，重点测分叉场景：回到中间节点后再次 `addVersion`，验证原分支节点没有被覆盖或删除
- [ ] `computeOutpaintMask`（第 6.2 节的纯函数）用几组不同的原图尺寸/目标尺寸/偏移量组合做单测，验证输出蒙版的黑白区域坐标正确

## 8. 已知依赖与开放问题

- **本方案假设 Stage 2 严格按 `canvas-interaction-plan.md` 实现**，如有出入需要先调整本方案再动手，见第 0 节
- **版本节点的粒度需要和产品侧确认**：现在的设计是"只有生成成功才算一个版本"，如果以后要支持"手动涂抹到一半也能存草稿"，版本树的数据结构需要扩展，不在本方案范围
- **融合（multi-source）、打光（light-control）两种交互模式还没有对应插件**，等这两个工具的原型完成后，需要补齐 `EditorToolPlugin` 实现并注册进 `toolRegistry.ts`，本方案只保证引擎架构本身支持这样扩展，不包含这两个插件的具体实现
- **版本树目前只存在前端内存里**，刷新页面会丢失，是否需要持久化到后端（对应架构文档提过的 `image_versions` 表）由 Stage 4/5 决定，本方案的数据结构设计已经考虑了后续对接后端的可能性（`taskId` 字段可以关联后端记录）
