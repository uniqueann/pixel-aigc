# Pixel Editor Architecture v1

> 状态：Architecture Proposal / Authoritative Architecture
>
> 本文是 Pixel Editor v1 的上位架构文档。Stage/Milestone 实施文档必须遵循本文；若实施文档与本文冲突，以本文为准。
>
> 目标：在不推翻现有 ImageWorkstation / Fabric.js 实现的前提下，为 Pixel AIGC 建立可持续扩展到自由画布、文生图、文生视频、资产管理与后续 Timeline 的统一 Editor Core。

## 1. 架构原则

当前项目已经从 UI Scaffold 进入 Interactive Prototype。ImageWorkstation 已有 MaskPaintCanvas、OutpaintCanvas、蒙版导出、Undo/Redo、Smart Select mock、任务提交和轮询。下一阶段的重点不是重写这些能力，而是建立稳定领域边界。

核心原则：

1. React Page 负责装配，不作为 Editor Engine。
2. AI Task、GenerationJob、Asset、Canvas Node 是不同实体。
3. Provider API 与 Editor Domain 解耦。
4. 图片工作台与 FreeCanvas 共享 Asset / Generation / Editor Core，但允许不同 interaction surface。
5. **共享的是 Editor Domain/State，不要求共享同一个 `fabric.Canvas` runtime instance。**
6. Fabric.js 是 renderer / interaction adapter，不是持久化领域模型。
7. Timeline 先定义模型边界，不在 v1 实现完整 NLE。
8. 所有迁移采用增量方式，现有 MaskPaint / Outpaint 持续可运行。

---

## 2. 领域模型

```text
PixelProject
├── document: PixelDocument
├── assets: AssetRegistry
├── generations: GenerationRegistry
└── metadata

PixelDocument
├── scenes[]
├── activeSceneId
└── version

Scene
├── nodes[]
├── viewport
└── timeline?          # v1 仅保留扩展点

Asset
├── ImageAsset
├── VideoAsset
└── AudioAsset

Node
├── ImageNode
├── VideoNode
├── TextNode
├── ShapeNode
└── GenerationNode

GenerationJob
├── capability
├── inputAssetIds[]
├── outputAssetIds[]
├── parentGenerationId?
├── status
└── provider/backend metadata
```

必须保持：

```text
GenerationTask != GenerationJob != Asset != Node
```

典型生成链：

```text
UI Intent
  ↓
GenerationTask / backend
  ↓ adapter
GenerationJob
  ↓
ImageAsset / VideoAsset
  ↓
ImageNode / VideoNode
  ↓
Scene / Canvas
```

同一个 Asset 可以被多个 Node 引用；删除 Node 不应自动删除 Asset。GenerationJob 保存生成过程与 provenance，Asset 保存可复用媒体资源，Node 保存画布中的表现和变换。

---

## 3. 核心 TypeScript Contract

建议放入 `src/editor/types/`，不要继续把 Editor Domain 堆入 `src/types/index.ts`。

```typescript
export type ProjectId = string
export type SceneId = string
export type NodeId = string
export type AssetId = string
export type GenerationId = string

export interface PixelProject {
  id: ProjectId
  name: string
  document: PixelDocument
  assets: Record<AssetId, Asset>
  generations: Record<GenerationId, GenerationJob>
  createdAt: string
  updatedAt: string
}

export interface PixelDocument {
  version: 1
  scenes: Scene[]
  activeSceneId: SceneId
}

export interface Scene {
  id: SceneId
  name: string
  width: number
  height: number
  background?: string
  nodes: EditorNode[]
  viewport: ViewportState
}

export interface ViewportState {
  zoom: number
  panX: number
  panY: number
}
```

Node：

```typescript
interface BaseNode {
  id: NodeId
  name?: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  visible: boolean
  locked: boolean
  zIndex: number
}

export interface ImageNode extends BaseNode {
  type: 'image'
  assetId: AssetId
}

export interface VideoNode extends BaseNode {
  type: 'video'
  assetId: AssetId
  startTime?: number
  duration?: number
}

export interface TextNode extends BaseNode {
  type: 'text'
  text: string
  fontFamily: string
  fontSize: number
}

export interface ShapeNode extends BaseNode {
  type: 'shape'
  shape: 'rect' | 'ellipse'
  fill: string
}

export interface GenerationNode extends BaseNode {
  type: 'generation'
  generationId: GenerationId
  outputAssetId?: AssetId
}

export type EditorNode = ImageNode | VideoNode | TextNode | ShapeNode | GenerationNode
```

Asset：

```typescript
interface BaseAsset {
  id: AssetId
  name: string
  url: string
  mimeType: string
  createdAt: string
  source: 'upload' | 'generation' | 'derived'
  generationId?: GenerationId
}

export interface ImageAsset extends BaseAsset {
  type: 'image'
  width: number
  height: number
}

export interface VideoAsset extends BaseAsset {
  type: 'video'
  width: number
  height: number
  duration: number
}

export interface AudioAsset extends BaseAsset {
  type: 'audio'
  duration: number
}

export type Asset = ImageAsset | VideoAsset | AudioAsset
```

Generation：

```typescript
export interface GenerationJob<TInput = unknown> {
  id: GenerationId
  capability: Capability
  status: TaskStatus
  input: TInput
  inputAssetIds: AssetId[]
  outputAssetIds: AssetId[]
  parentGenerationId?: GenerationId
  backendTaskId?: string
  error?: string
  createdAt: string
  updatedAt: string
}
```

`parentGenerationId` 是可选快捷关系；真正的 lineage 以 `inputAssetIds → outputAssetIds` 为主，因此未来可以自然表达 multi-source generation。

---

## 4. Editor State 与 Server State

### Zustand：本地 Editor State

负责高频、同步、可撤销的编辑状态：

```text
project/document
activeScene
nodes
selection
viewport
interaction mode
document history
```

### TanStack Query：Server State

继续负责：

```text
GenerationTask
upload state
provider/backend result
remote assets
account/credits
```

任务轮询结果不能直接写成 Canvas Node。成功结果先经 adapter 注册为 Asset，再由 command 添加 Node。

---

## 5. 三层 History 模型

Pixel 不使用一套 History 解决所有问题。v1 明确分为三层：

### 5.1 Tool-local History

用于工具内部尚未提交的 transient interaction，例如 MaskPaint 的笔画 Undo/Redo。

```text
Brush stroke
Eraser stroke
Mask snapshot
```

现有 MaskPaintCanvas 的像素快照 History 保留，不强行迁入全局 store。

### 5.2 Document Command History

用于已进入 Editor Document 的可撤销编辑操作：

```text
Add Node
Remove Node
Move
Resize
Rotate
Update
```

建议通过 Command boundary：

```typescript
export interface EditorCommand {
  id: string
  execute(ctx: EditorContext): void
  undo(ctx: EditorContext): void
}
```

首批 Commands：

```text
AddNodeCommand
RemoveNodeCommand
MoveNodeCommand
ResizeNodeCommand
RotateNodeCommand
UpdateNodeCommand
InsertGeneratedAssetCommand
```

不要把 pointer move 的每一帧写入 History；interaction end 时 commit 一条 command。

### 5.3 Generation Lineage

AI 生成历史不是 Undo 栈，也不应建成只保存 `imageUrl` 的独立 VersionTree。GenerationRegistry + Asset relationships 本身构成 lineage graph。

```text
Original ImageAsset
       │
       ▼
   Remove Job
       │
       ▼
 ImageAsset A
    │       │
    ▼       ▼
Outpaint  Repaint
    │       │
    ▼       ▼
Asset B   Asset C
              │
              ▼
        Image-to-Video
              │
              ▼
         VideoAsset D
```

因此：

```text
Tool-local History       = “这笔画错了”
Document Command History = “这个对象移动/删除错了”
Generation Lineage       = “回到某个 AI 结果继续生成新分支”
```

Generation Lineage 支持 Image→Image、Image→Video、Video→Video、Prompt→Image、Prompt→Video、Multi-Image→Image，而不是被限制为图片版本树。

---

## 6. ImageWorkstation 演进

现有组件原则上保留：

```text
ToolSidebar
CanvasArea
MaskPaintCanvas
OutpaintCanvas
BrushToolbar
ParamPanel
```

### 6.1 不建立“唯一共享 Fabric Canvas”作为 Stage 3 前提

MaskPaint 与 Outpaint 是不同 interaction surface。允许它们维护各自 Fabric runtime，以避免 drawing mode、brush、selection、controls、event listeners、contextTop、composite operation 等状态在工具切换时泄漏。

架构共享点是：

```text
PixelProject / EditorStore
AssetRegistry
GenerationRegistry
GenerationService
Workstation Controller
```

而不是：

```text
one global fabric.Canvas
```

未来若多个工具被证明可以安全共享同一 Fabric runtime，可以作为性能优化，而不是领域架构约束。

### 6.2 Controller Layer

新增：

```text
ImageWorkstation
      ↓
useImageWorkstationController()
      ↓
GenerationService + EditorStore
```

逐步从 page 移出：

```text
mask export
uploadDataUrl
requestId
createTask
capability-specific request build
任务成功后的 Asset 注册
```

### 6.3 Workstation Tool Registry

保留工具注册思想，但 registry 描述 capability 和 interaction，而不是控制 Fabric lifecycle：

```typescript
interface WorkstationToolDefinition {
  slug: string
  capability: Capability
  interactionMode: InteractionMode
  validate?: (ctx: WorkstationContext) => ValidationResult
  buildRequest: (ctx: WorkstationContext) => WorkstationGenerationRequest
}
```

CanvasArea 仍可根据 `interactionMode` 选择 MaskPaintCanvas / OutpaintCanvas / 后续 interaction adapter。

不要要求 ToolDefinition 实现 `mount(engine)` / `unmount(engine)`。

---

## 7. FreeCanvas 定位与技术路线

FreeCanvas v1 定义为 **AI-native spatial canvas**：不是完整 Photoshop，也不是纯 ComfyUI node graph。

```text
Prompt / Generate
      ↓
Generation placeholder
      ↓
Result image/video
      ↓
自由移动、缩放、复制、比较
      ↓
Edit / Variation / Image-to-Video
```

技术路线：

- Fabric.js：媒体对象、transform、selection、zoom/pan 的主 spatial canvas。
- React DOM：Inspector、Prompt、Toolbar、Context Menu、Modal。
- v1 不引入 React Flow 作为主画布。
- 若未来确有强 DAG workflow 需求，再作为独立 Workflow View 引入 React Flow。
- WebGL 不作为 v1 前置依赖；性能数据证明 Fabric/Canvas2D 不足后再引入。

---

## 8. Generation Pipeline

```text
UI Intent
  ↓
GenerationService
  ↓
Capability Adapter
  ↓
Upload required inputs
  ↓
createTask()
  ↓
GenerationJob registered
  ↓
TanStack Query polling / future SSE
  ↓
Task succeeded
  ↓
Result URL -> Asset
  ↓
AssetRegistry
  ↓
InsertGeneratedAssetCommand
  ↓
Canvas Node
```

Provider-specific branching 留在后端。前端即使允许模型选择，也应依赖 backend exposed model profile，而不是直接耦合 Provider SDK。

---

## 9. Video / Timeline v1 边界

v1 只定义 contract：

```typescript
export interface Timeline {
  duration: number
  tracks: Track[]
}

export interface Track {
  id: string
  type: 'video' | 'audio' | 'overlay'
  clips: Clip[]
}

export interface Clip {
  id: string
  assetId: AssetId
  timelineStart: number
  sourceStart: number
  duration: number
}
```

第一阶段 Text-to-Video 结果作为 VideoAsset + VideoNode 在 FreeCanvas 播放/比较。

v1 不做：多轨专业 NLE、WebCodecs renderer、frame-accurate trimming、transition engine、audio waveform editor。

---

## 10. 推荐目录结构

```text
src/
├── editor/
│   ├── types/
│   │   ├── project.ts
│   │   ├── document.ts
│   │   ├── node.ts
│   │   ├── asset.ts
│   │   ├── generation.ts
│   │   └── timeline.ts
│   ├── store/
│   │   ├── editorStore.ts
│   │   ├── selectionSlice.ts
│   │   ├── viewportSlice.ts
│   │   └── historySlice.ts
│   ├── commands/
│   ├── services/
│   │   ├── generationService.ts
│   │   └── assetService.ts
│   ├── adapters/
│   │   ├── taskAdapter.ts
│   │   └── fabricAdapter.ts
│   └── selectors/
├── features/
│   ├── image-workstation/
│   ├── free-canvas/
│   ├── assets/
│   └── generation/
├── services/          # HTTP/backend contracts
├── pages/             # route composition only
└── components/        # app-wide generic UI
```

不要求一次性移动现有 ImageWorkstation。先建立 `editor/`，旧组件按 milestone 渐进迁移。

---

## 11. 分阶段实施

### M0 — Architecture Freeze

- 新建 `src/editor/types/*`
- 明确 Project / Document / Scene / Node / Asset / Generation 类型
- 保留 `src/types` API contracts
- 必要时新增 ADR
- build / lint 保持通过

### M1 — Editor Store Foundation

- editorStore
- scene/node CRUD
- selection
- viewport
- selectors
- command/history skeleton
- unit tests

验收：不接 UI 也能通过 tests 完成 add/move/remove/undo/redo。

### M2 — Asset + Generation Boundary

- AssetRegistry
- GenerationRegistry
- GenerationService
- task → generation adapter
- result URL → Asset adapter
- upload abstraction
- Generation Lineage 基础关系

验收：mock Text-to-Image 成功后生成 ImageAsset，而不是只得到裸 URL。

### M3 — ImageWorkstation Controller Migration

- `useImageWorkstationController`
- request builder 从 page 移出
- Workstation Tool Registry
- MaskPaint / Outpaint 不重写
- 生成结果注册 Asset / GenerationJob
- page 只负责 route + layout + event wiring

### M4 — FreeCanvas MVP

- Fabric viewport
- ImageNode / VideoNode
- selection / transform / zoom / pan
- Text-to-Image / Text-to-Video placeholder
- generation success → Asset → Node
- 从已有 Asset 发起 Variation / Image-to-Video
- Project JSON 保存/恢复

不实现 Timeline、复杂滤镜、主画布 node graph。

### M5 — Persistence

- Project serialization
- schema version
- autosave debounce
- remote project API contract
- migration strategy

### M6 — Advanced Editor

按产品反馈选择：Layers、grouping、alignment/snapping、copy/paste、keyboard shortcuts、context menu、Generation Lineage UI、更丰富图片编辑。

### M7 — Timeline Decision Gate

只有出现明确的多片段组合、音频/字幕/overlay 编排需求，才进入 Timeline Engine / Playback Resolver / Renderer。

---

## 12. 模型分工

### GPT-6 Astra

用于：Editor domain architecture、FreeCanvas interaction architecture、cross-module migration plan、Timeline architecture、复杂状态/并发问题、browser-driven UX/QA。

### GPT-5.6 Sol

默认开发模型：React components、Fabric integrations、Zustand stores、commands、adapters、API integration、tests、Ant Design/CSS、增量重构。

原则：Astra 决定高成本边界，Sol 实现已确定边界。

---

## 13. Guardrails

1. 不为了新架构重写已工作的 MaskPaintCanvas / OutpaintCanvas。
2. 不把 Fabric object 当作 Project JSON 或数据库 schema。
3. 不把后端 GenerationTask 直接当 Canvas Node。
4. 不以“唯一共享 fabric.Canvas”作为 Editor Core 的前提。
5. 不在 React component 内新增 Provider-specific branching。
6. 不在 v1 同时引入 Fabric + React Flow + WebGL 三套主渲染系统。
7. 不把所有 Editor 状态塞进一个巨型 Zustand 文件；使用 slices/selectors。
8. 不把 pointer move 每一帧写入 Document History。
9. 不把 Generation Lineage 简化成只保存 `imageUrl` 的版本树。
10. 不因为未来可能做视频剪辑就提前实现完整 Timeline。
11. 每个 milestone 都必须可 build、可运行、可回退。

---

## 14. Definition of Done

Editor Architecture v1 落地需满足：

- PixelProject / PixelDocument / Scene / Asset / EditorNode / GenerationJob 成为明确领域实体。
- API task contracts 与 Editor entities 分离。
- Fabric.js 只作为 canvas adapter/renderer，不是持久化 schema。
- Tool-local History、Document Command History、Generation Lineage 三层语义明确。
- ImageWorkstation page 不再负责完整 generation orchestration。
- MaskPaint / Outpaint 现有能力无回归。
- FreeCanvas 完成 Text-to-Image / Text-to-Video → Asset → Node 闭环。
- Node 基础 transform、selection、viewport、history 可用。
- Project 可序列化、恢复并带 schema version。
- Timeline contract 存在，但专业 Timeline Engine 未提前实现。
- build、lint、核心 editor tests 通过。

完成这些内容后，Pixel AIGC 才从“多个 AIGC 页面集合”升级为拥有统一领域模型的 AI-native Editor。