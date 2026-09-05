# Pixel Editor Architecture v1

> 状态：Architecture Proposal
>
> 目标：在不推翻现有 ImageWorkstation / Fabric.js 实现的前提下，为 Pixel AIGC 建立可持续扩展到自由画布、文生图、文生视频、资产管理与后续 Timeline 的统一 Editor Core。

## 1. 为什么现在需要 Editor Core

当前项目已经从 UI Scaffold 进入 Interactive Prototype：ImageWorkstation 已有 MaskPaintCanvas、OutpaintCanvas、蒙版导出、Undo/Redo、Smart Select mock、任务提交和轮询。下一阶段如果继续把工具状态、任务参数组装、上传和 Canvas ref 全部放在 page component 中，ImageWorkstation 和 FreeCanvas 会逐渐承担过多职责。

本次架构升级不重写已验证的 Fabric.js 画布，而是在其上建立稳定的领域边界。

核心原则：

1. React Page 负责装配，不作为 Editor Engine。
2. AI Task、Asset、Canvas Node 是三个不同实体。
3. Provider API 与 Editor Domain 解耦。
4. 图片编辑和自由画布共享 Asset / Generation / History 基础设施，但保留不同交互层。
5. Timeline 先定义模型边界，不在 v1 实现完整视频编辑器。
6. 所有迁移均采用增量方式，现有功能持续可运行。

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
├── input
├── status
├── provider metadata
└── outputAssetIds[]
```

必须保持以下关系：

```text
GenerationJob != Asset != Node

Text-to-Image Request
        ↓
GenerationJob
        ↓
ImageAsset
        ↓
ImageNode
        ↓
Scene / Canvas
```

同一个 Asset 可以被多个 Node 引用；删除 Node 不应自动删除 Asset。GenerationJob 保存生成过程与 provenance，Asset 保存可复用媒体资源，Node 保存画布中的表现和变换。

---

## 3. 推荐 TypeScript 类型

建议新增 `src/editor/types/`，不要继续把所有领域类型堆入 `src/types/index.ts`。

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
  backendTaskId?: string
  outputAssetIds: AssetId[]
  error?: string
  createdAt: string
  updatedAt: string
}
```

现有 `GenerationTask` 继续作为 API contract；不要直接把它升级成 Editor entity。

---

## 4. Editor State 与 Server State

### Zustand：本地 Editor State

Zustand 负责高频、同步、可撤销的编辑状态：

```text
project/document
activeScene
nodes
selection
viewport
interaction mode
history
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

不要把任务轮询结果直接写成 Canvas Node。应通过 adapter/application layer 将成功结果注册为 Asset，再由 command 添加 Node。

---

## 5. Command + History

Canvas 编辑操作建议进入统一 command boundary，而不是组件直接任意修改 Zustand。

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
AddAssetCommand
InsertGeneratedAssetCommand
```

注意：MaskPaintCanvas 当前的像素快照 Undo/Redo 保留。它属于工具内部 transient history，不必立即迁入全局 command history。

因此 v1 有两层 History：

```text
Document History
└── Node/Scene/Project commands

Tool-local History
└── Mask brush snapshots
```

两者不要强行合并。

---

## 6. ImageWorkstation 演进

现有组件保留：

```text
ToolSidebar
CanvasArea
MaskPaintCanvas
OutpaintCanvas
BrushToolbar
ParamPanel
```

新增 application/controller 层：

```text
ImageWorkstation
      ↓
useImageWorkstationController()
      ↓
GenerationService + EditorStore
```

目标是把当前 page 中这些职责迁出：

```text
mask export
uploadDataUrl
requestId
createTask
任务类型参数组装
任务成功后的 Asset 注册
```

建议：

```typescript
interface WorkstationGenerationRequest {
  toolSlug: string
  sourceAssetId: AssetId
  interactionResult?: unknown
  params: Record<string, unknown>
}

async function submitWorkstationGeneration(request: WorkstationGenerationRequest) {
  // 1. interaction result -> upload
  // 2. request -> backend task params
  // 3. create task
  // 4. register GenerationJob
}
```

不要让 `ImageWorkstation/index.tsx` 继续新增 capability-specific `if/else`。

---

## 7. FreeCanvas 定位

v1 将 FreeCanvas 定义为 **AI-native spatial canvas**，不是完整 Photoshop，也不是纯 ComfyUI node graph。

用户看到的是可自由排布的媒体对象；AI generation 关系可以显式呈现，但不要求所有内容必须连线。

推荐交互：

```text
Prompt / Generate
      ↓
Generation placeholder node
      ↓
Result image/video
      ↓
用户可自由移动、缩放、复制、比较
      ↓
从结果触发 Edit / Variation / Image-to-Video
```

GenerationNode 可以表达正在生成和 lineage；成功后可以保留 generation metadata，同时渲染 output Asset。

### Canvas 技术路线

v1 推荐：

- Fabric.js：媒体对象、transform、selection、zoom/pan 的主 spatial canvas。
- React DOM：Inspector、Prompt、Toolbar、Context Menu、Modal。
- 不在 v1 引入 React Flow 作为主画布。
- 如果未来出现强 node-graph workflow 需求，再作为独立 Workflow View 引入 React Flow，而不是让它承担视觉编辑器。
- WebGL 不作为 v1 前置依赖；当滤镜、实时视频合成或大规模对象性能证明 Canvas2D/Fabric 不够时再引入渲染层。

理由：当前产品核心是“看见并编辑媒体结果”，不是“搭建推理 DAG”。

---

## 8. Generation Pipeline

统一生成流程：

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

Provider 仍然只存在后端抽象层。前端不能出现 `openaiModel` / `midjourneyModel` 之类 Provider-specific branching，除非产品明确允许用户选择 Provider；即便允许，也应使用 backend exposed model profile，而不是前端直接依赖 Provider SDK。

---

## 9. Video / Timeline v1 边界

本阶段只定义 contract：

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

关系：

```text
VideoAsset
   ↓ referenced by
Clip
   ↓ resolved by
Timeline
   ↓
Preview Renderer
```

v1 不做：

- 多轨专业 NLE
- WebCodecs renderer
- frame-accurate trimming
- transition engine
- audio waveform editor

第一阶段 Text-to-Video 结果只作为 VideoAsset + VideoNode 在 FreeCanvas 中播放/比较。只有产品验证确实需要剪辑能力后，再进入 Timeline Engine milestone。

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
│
├── features/
│   ├── image-workstation/
│   ├── free-canvas/
│   ├── assets/
│   └── generation/
│
├── services/          # HTTP/backend contracts
├── pages/             # route composition only
└── components/        # app-wide generic UI
```

不要求一次性移动现有 `pages/ImageWorkstation`。先创建 `editor/`，新代码走新边界；旧组件按 milestone 渐进迁移。

---

## 11. 分阶段实施计划

### M0 — Architecture Freeze

目标：只建立 contract，不改变 UI 行为。

- 新建 `src/editor/types/*`
- 明确 ID / Project / Document / Scene / Node / Asset / Generation 类型
- 新建 architecture decision records（需要时）
- 保留现有 `src/types` API contracts
- `npm run build` / `npm run lint` 必须保持通过

推荐模型：GPT-6 Astra 设计；GPT-5.6 Sol 实现。

### M1 — Editor Store Foundation

- 建立 editorStore
- scene/node CRUD
- selection
- viewport
- selectors
- command/history skeleton
- unit tests

验收：不接 UI 也能通过 store/command tests 完成 add/move/remove/undo/redo。

推荐模型：Sol。

### M2 — Asset + Generation Boundary

- AssetRegistry
- GenerationRegistry
- GenerationService
- task -> generation adapter
- result URL -> Asset adapter
- upload asset abstraction

验收：mock Text-to-Image task 成功后可以生成 ImageAsset，而不是只得到裸 URL。

推荐模型：Sol；Astra review boundary。

### M3 — ImageWorkstation Controller Migration

- 新增 `useImageWorkstationController`
- capability-specific request builder 从 page 移出
- 现有 MaskPaint / Outpaint 不重写
- 生成结果注册 Asset
- 页面只负责 route + layout + event wiring

验收：现有 remove/repaint/outpaint 行为不回归；page 显著减薄。

推荐模型：Sol。

### M4 — FreeCanvas MVP

实现：

- Fabric viewport
- ImageNode
- VideoNode
- selection
- transform
- zoom/pan
- add generated result to canvas
- prompt panel
- Text-to-Image generation placeholder
- Text-to-Video generation placeholder
- generation success -> Asset -> Node

不实现：Timeline、复杂滤镜、node graph。

验收场景：

```text
输入 Prompt
→ 文生图
→ Canvas 出现结果
→ 移动/缩放
→ 从图片发起 Variation
→ 新结果出现在旁边
→ 文生视频
→ VideoNode 可播放
→ 保存/恢复 Project JSON
```

推荐模型：Astra 先做 implementation plan；Sol 分任务开发；Astra 做 browser/UX review。

### M5 — Persistence

- Project serialization
- schema version
- autosave debounce
- remote project API contract
- migration strategy

必须从第一版就带 `document.version`，不要等线上已有用户项目后再补 schema migration。

推荐模型：Sol。

### M6 — Advanced Editor Features

按产品反馈决定优先级：

- Layers panel
- grouping
- alignment/snapping
- copy/paste
- keyboard shortcuts
- context menu
- generation lineage visualization
- richer image editing integration

推荐模型：Sol；复杂交互由 Astra review。

### M7 — Timeline Decision Gate

只有满足至少一个条件才进入 Timeline：

1. 用户明确需要组合多个视频片段；
2. 需要音频/字幕/overlay 编排；
3. 单纯生成 + 预览无法满足主要工作流。

进入后再设计 Timeline Engine / Playback Resolver / Renderer，不提前构建 NLE。

---

## 12. 模型分工策略

### GPT-6 Astra

只用于高杠杆任务：

- Editor domain architecture
- FreeCanvas interaction architecture
- cross-module refactor plan
- Timeline architecture
- difficult state/concurrency bugs
- large migration review
- browser-driven UX / frontend QA

### GPT-5.6 Sol

作为默认开发模型：

- React components
- Fabric integrations
- Zustand stores
- commands
- adapters
- API integration
- tests
- CSS / Ant Design
- incremental refactors

原则：Astra 决定边界和复杂迁移策略，Sol 实现已确定的边界。不要让 Astra 承担机械组件开发。

---

## 13. 禁止事项 / Guardrails

后续 Agent 开发必须遵守：

1. 不为了新架构重写已工作的 MaskPaintCanvas / OutpaintCanvas。
2. 不把 Fabric object 当作持久化领域模型；Fabric 是 renderer/interaction adapter。
3. 不把后端 `GenerationTask` 直接当作 Canvas Node。
4. 不在 React component 内增加新的 Provider-specific 分支。
5. 不在 v1 同时引入 Fabric + React Flow + WebGL 三套主渲染系统。
6. 不把所有 Editor 状态放进一个巨型 Zustand store 文件；使用 slice/selectors。
7. 不把每次 pointer move 都写入全局 undo history；交互结束后 commit command。
8. 不因为未来可能做视频剪辑就提前实现完整 Timeline。
9. 不允许 Project JSON 持久化 Fabric.js 私有对象结构。
10. 新架构迁移必须保证每个 milestone 都可 build、可运行、可回退。

---

## 14. Definition of Done — Editor Architecture v1

当以下条件全部满足，认为 v1 架构落地：

- `PixelProject / PixelDocument / Scene / Asset / EditorNode / GenerationJob` 成为明确领域实体。
- API task contracts 与 Editor entities 分离。
- Fabric.js 只作为 canvas adapter/renderer，而不是数据库 schema。
- ImageWorkstation page 不再负责完整 generation orchestration。
- FreeCanvas 能完成 Text-to-Image / Text-to-Video -> Asset -> Node 的闭环。
- Node 基础 transform、selection、viewport、history 可用。
- Project 可序列化、恢复，并带 schema version。
- MaskPaint / Outpaint 现有能力无回归。
- Timeline contract 存在，但专业 Timeline Engine 不提前实现。
- build、lint、核心 editor tests 通过。

完成上述内容后，Pixel AIGC 才真正从“多个 AIGC 页面集合”升级为拥有统一领域模型的 AI-native Editor。