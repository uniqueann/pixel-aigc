# Stage 3 · Editor Core Implementation Plan v2

> 状态：Implementation Plan
>
> 上位架构：`docs/pixel-editor-architecture-v1.md`
>
> **权威性规则：若本文与 `pixel-editor-architecture-v1.md` 冲突，以上位架构为准。**

给接手这部分开发的 Agent/开发者：Stage 3 的目标从原来的“共享 Fabric Engine + Tool Plugin + 图片版本树”调整为 **Editor Core Foundation + ImageWorkstation Integration**。

Stage 3 不推翻 Stage 2 已验证的 MaskPaintCanvas / OutpaintCanvas，而是先建立 Project / Document / Asset / Node / Generation 的领域边界，再把 ImageWorkstation 逐步接入。

---

## 0. 开始前必须核实现状

Stage 2 由其他 Agent 按 `docs/canvas-interaction-plan.md` 实现。开始编码前必须读取实际代码，至少确认：

- `MaskPaintCanvasHandle`
- `OutpaintCanvasHandle`
- `exportMask()`
- `CanvasArea` 的 `interactionMode` 分支
- MaskPaint 的局部 history
- Outpaint 的 transform/export contract
- `ImageWorkstation/index.tsx` 当前 generation orchestration
- `GenerationTask` / `createTask` / polling 实际接口

实际代码优先于旧计划中的签名。发现差异时先更新实施计划，不允许为了匹配文档而重写已经正确工作的代码。

---

## 1. Stage 3 目标

Stage 3 交付六块能力：

```text
3.0 Architecture Contracts
        ↓
3.1 Editor Store
        ↓
3.2 Command History
        ↓
3.3 Asset + Generation Boundary
        ↓
3.4 ImageWorkstation Controller
        ↓
3.5 Generation Lineage Foundation
```

Generation Lineage UI 不作为 Stage 3 的阻塞项，可在 3.6 或 Stage 4 后半段实现。

Stage 3 完成后，ImageWorkstation 应仍保持现有视觉和工具行为，但底层已经能够接入未来 FreeCanvas。

---

## 2. 本次明确取消的旧方案

以下旧 Stage 3 约束不再执行：

### 2.1 取消“所有工具共享唯一 fabric.Canvas”

不再要求：

```text
CanvasArea
  ↓
one fabric.Canvas
  ↓
mount/unmount Tool Plugin
```

原因：MaskPaint 与 Outpaint 的 Fabric runtime 状态差异较大。drawing mode、brush、selection、controls、event listeners、contextTop、composite operation 等共享 runtime 会增加状态泄漏和清理复杂度。

新的原则：

> **共享 Editor Domain/State，不强制共享 Fabric runtime。**

现有 MaskPaintCanvas / OutpaintCanvas 可以继续各自管理 Canvas 生命周期。

### 2.2 取消 `useEditorDocument` 的 URL-centric 模型

不再新增：

```typescript
EditorDocument {
  originalImageUrl
  currentImageUrl
  lastGeneratedTaskId
}
```

该模型只能表达“连续修改一张图片”，无法支撑 FreeCanvas、多结果、Image→Video、multi-source generation。

统一采用 `PixelProject / PixelDocument / Scene / Asset / Node / GenerationJob`。

### 2.3 取消独立 `useEditVersionTree` 作为核心模型

不再使用只保存：

```text
parentId
toolSlug
imageUrl
taskId
```

的图片版本树。

版本分叉能力由 GenerationRegistry + Asset relationships 表达，称为 **Generation Lineage**。

### 2.4 HistoryPanel 延后

Stage 3 优先领域和 orchestration 边界。不要先基于裸 URL 做 HistoryPanel，再在 Asset/Generation 落地后重写。

---

## 3. Stage 3.0 — Architecture Contracts

### 3.0.1 新建目录

```text
src/editor/
└── types/
    ├── ids.ts
    ├── project.ts
    ├── document.ts
    ├── node.ts
    ├── asset.ts
    ├── generation.ts
    └── index.ts
```

`timeline.ts` 可以在 M0 建 contract，也可以等 FreeCanvas 前补齐；Stage 3 不实现 Timeline Engine。

### 3.0.2 ID Types

```typescript
export type ProjectId = string
export type SceneId = string
export type NodeId = string
export type AssetId = string
export type GenerationId = string
```

### 3.0.3 PixelProject

```typescript
export interface PixelProject {
  id: ProjectId
  name: string
  document: PixelDocument
  assets: Record<AssetId, Asset>
  generations: Record<GenerationId, GenerationJob>
  createdAt: string
  updatedAt: string
}
```

### 3.0.4 Document / Scene

```typescript
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
```

### 3.0.5 Asset

至少定义：

```text
ImageAsset
VideoAsset
AudioAsset
```

Stage 3 实际接入 ImageAsset 即可，但类型边界必须允许后续 VideoAsset。

### 3.0.6 Node

至少定义：

```text
ImageNode
VideoNode
TextNode
ShapeNode
GenerationNode
```

Stage 3 不要求所有 Node 都渲染；它们是 FreeCanvas 的 contract foundation。

### 3.0.7 GenerationJob

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

### 3.0.8 关键边界

现有 `src/types` 中的 `GenerationTask` 等继续作为 API contract。

禁止：

```text
GenerationTask == GenerationJob
GenerationTask == Canvas Node
Asset == Node
```

验收：

- `npm run build` 通过
- `npm run lint` 通过
- 无 UI 行为变化

---

## 4. Stage 3.1 — Editor Store Foundation

新建：

```text
src/editor/store/
├── editorStore.ts
├── projectSlice.ts
├── selectionSlice.ts
├── viewportSlice.ts
└── historySlice.ts
```

不要建立一个巨型单文件 store。

### 4.1 最小 State

```text
project
activeSceneId
selectedNodeIds
viewport
```

### 4.2 最小 Actions

```text
createProject
loadProject
setActiveScene
addNode
removeNode
updateNode
selectNodes
clearSelection
setViewport
registerAsset
registerGeneration
```

### 4.3 Selector

UI 尽量通过 selectors 读取派生数据，例如：

```text
selectActiveScene
selectSelectedNodes
selectAssetById
selectGenerationById
```

不要让组件遍历整个 Project 自己计算。

验收：store unit tests 可以创建 Project、注册 Asset、添加/修改/删除 Node。

---

## 5. Stage 3.2 — Command + Document History

新建：

```text
src/editor/commands/
```

首批 command：

```text
AddNodeCommand
RemoveNodeCommand
MoveNodeCommand
ResizeNodeCommand
UpdateNodeCommand
InsertGeneratedAssetCommand
```

接口示例：

```typescript
export interface EditorCommand {
  id: string
  execute(ctx: EditorContext): void
  undo(ctx: EditorContext): void
}
```

### 5.1 与 Mask History 的关系

MaskPaintCanvas 当前的 brush snapshot history 保持原样。

```text
Tool-local History
└── brush / eraser / mask snapshots

Document Command History
└── node add/remove/move/resize/update
```

不要把 Mask 每一笔写入 EditorStore History。

### 5.2 Commit 时机

拖拽/resize 过程中可以实时更新 renderer，但只在 interaction end 时 commit 一条 history command。

验收：纯 store/command tests 可完成 add → move → remove → undo → redo。

---

## 6. Stage 3.3 — Asset + Generation Boundary

新建：

```text
src/editor/services/
├── assetService.ts
└── generationService.ts

src/editor/adapters/
└── taskAdapter.ts
```

### 6.1 Asset Boundary

所有进入 Editor 的媒体都先成为 Asset。

```text
Upload
  ↓
ImageAsset

Generation Result URL
  ↓
ImageAsset / VideoAsset
```

Canvas / Workstation 不应该长期以裸 URL 作为唯一 identity。

### 6.2 Generation Boundary

统一流程：

```text
Workstation Intent
  ↓
GenerationService
  ↓
Capability Request Builder
  ↓
createTask
  ↓
GenerationJob
  ↓
polling
  ↓
Task succeeded
  ↓
Asset
```

### 6.3 Adapter

`taskAdapter.ts` 负责 API contract → Editor entity，例如：

```text
GenerationTask → GenerationJob
resultUrls[] → Asset[]
```

不要让 page/component 自己做这些映射。

验收：mock 一个成功 Text-to-Image / Inpaint task，可以得到 GenerationJob + ImageAsset，而不是只有 `resultUrl`。

---

## 7. Stage 3.4 — ImageWorkstation Controller Migration

新增：

```text
src/features/image-workstation/
├── hooks/
│   └── useImageWorkstationController.ts
├── tools/
│   ├── registry.ts
│   └── requestBuilders/
└── types.ts
```

现有页面目录暂不要求一次性搬迁。

### 7.1 Controller 职责

从 `ImageWorkstation/index.tsx` 移出：

```text
mask export orchestration
uploadDataUrl
requestId
createTask
capability-specific params build
task success → GenerationJob
task result → Asset
```

Page 最终只负责：

```text
route
layout
active tool
UI event wiring
notification
```

### 7.2 Workstation Tool Registry

保留旧方案的配置化思想，但降低层级：

```typescript
export interface WorkstationToolDefinition {
  slug: string
  capability: Capability
  interactionMode: InteractionMode
  validate?: (ctx: WorkstationContext) => ValidationResult
  buildRequest: (ctx: WorkstationContext) => WorkstationGenerationRequest
}
```

Registry 不负责 Fabric lifecycle。

### 7.3 CanvasArea

继续允许：

```text
interactionMode
  ├── mask-paint  → MaskPaintCanvas
  ├── drag-resize → OutpaintCanvas
  ├── multi-source
  └── light-control
```

MaskPaintCanvas / OutpaintCanvas 不因 Stage 3 被重写成 plugin。

验收：

- remove/repaint/outpaint 原有行为无回归
- 跨 tool 切换仍能使用当前输入 Asset
- ImageWorkstation page 明显减薄
- capability-specific request branching 不继续堆在 page 中

---

## 8. Stage 3.5 — Generation Lineage Foundation

Generation Lineage 取代旧 `EditVersionTree`。

### 8.1 数据来源

核心关系：

```text
GenerationJob.inputAssetIds
GenerationJob.outputAssetIds
GenerationJob.parentGenerationId?
```

`parentGenerationId` 可用于快速导航，但不能成为唯一 lineage 依据，因为 multi-source generation 可能有多个输入 Asset。

### 8.2 分叉

用户从旧 Asset 再次发起生成时：

```text
Asset A
 ├── Job B → Asset B
 └── Job C → Asset C
```

自然形成分支，不覆盖任何已有 GenerationJob / Asset。

### 8.3 三层历史最终语义

| 层 | 粒度 | 示例 |
|---|---|---|
| Tool-local History | transient interaction | 一笔 mask |
| Document Command History | document edit | move / resize / delete |
| Generation Lineage | AI generation | remove / outpaint / variation / image-to-video |

### 8.4 Stage 3 不强制实现完整 Lineage UI

可以提供 selector：

```text
selectGenerationParents
selectGenerationChildren
selectAssetOrigin
```

History/Lineage UI 延后，避免先做 URL-centric UI 再重构。

验收：连续生成和从旧 Asset 分叉生成都能从 Registry 推导正确关系。

---

## 9. Stage 3.6 — Optional Lineage UI

只有 3.0–3.5 稳定后才开始。

如果产品需要，可将原“历史版本”占位升级为 Generation Lineage Panel：

```text
GenerationJob
  ↓
Output Asset thumbnail
  ↓
children branches
```

点击历史 Asset 的语义不是修改 `currentImageUrl`，而是把该 Asset 设置为当前 Workstation input / active context。

Stage 3.6 不是进入 Stage 4 的硬阻塞条件。

---

## 10. 文件清单

### 新建

```text
src/editor/types/*
src/editor/store/*
src/editor/commands/*
src/editor/services/assetService.ts
src/editor/services/generationService.ts
src/editor/adapters/taskAdapter.ts
src/editor/selectors/*
src/features/image-workstation/hooks/useImageWorkstationController.ts
src/features/image-workstation/tools/registry.ts
src/features/image-workstation/tools/requestBuilders/*
```

### 渐进修改

```text
src/pages/ImageWorkstation/index.tsx
src/pages/ImageWorkstation/components/CanvasArea.tsx
```

### 原则上保留实现

```text
MaskPaintCanvas.tsx
OutpaintCanvas.tsx
BrushToolbar
现有 mask export utilities
```

只有为接入新的 Asset/Controller contract 所必需时才做小范围修改。

### 不再创建

```text
src/store/useEditorDocument.ts
src/store/useEditVersionTree.ts
src/pages/ImageWorkstation/engine/useCanvasEngine.ts  # 作为“唯一共享 engine”方案
EditorToolPlugin mount/unmount Fabric lifecycle
```

---

## 11. 推荐实施顺序

严格按以下顺序：

1. **3.0 Architecture Contracts** — 只加类型，不改 UI。
2. **3.1 Editor Store** — 建 Project/Scene/Asset/Generation state foundation。
3. **3.2 Commands** — 先用 tests 验证 Document History。
4. **3.3 Asset + Generation** — 把 backend task 与 Editor entity 隔开。
5. **3.4 ImageWorkstation Controller** — 最后迁移现有业务 orchestration。
6. **3.5 Generation Lineage** — 在已有 Registry 上补 selector/tests。
7. **3.6 Optional UI** — 只有需要时做。

禁止先重构 Fabric Canvas 再补领域模型。

---

## 12. 测试策略

### Unit

重点覆盖：

```text
Project creation
Asset registration
Node CRUD
Command undo/redo
GenerationTask adapter
GenerationJob registration
Generation Lineage branching
```

### Regression

必须保留 Stage 2：

```text
Mask brush
Eraser
Undo/Redo
Smart Select mock
Mask export
Outpaint drag/resize
Outpaint export
```

### Integration

至少覆盖：

```text
上传图片
→ 注册 ImageAsset
→ remove/repaint/outpaint
→ createTask
→ succeeded
→ GenerationJob
→ output ImageAsset
→ 使用新 Asset 继续下一次生成
```

### Browser / Memory

- 多次进入/离开 ImageWorkstation 不持续泄漏 Fabric instance/event listeners。
- 工具切换后 drawing/selection 状态正确。
- 不再以“Fabric Canvas 只创建一次”作为验收指标。

---

## 13. Stage 3 Definition of Done

- [ ] `PixelProject / PixelDocument / Scene / Asset / EditorNode / GenerationJob` contract 落地。
- [ ] API `GenerationTask` 与 Editor `GenerationJob` 分离。
- [ ] Editor Store 基础 CRUD/selectors 可测试。
- [ ] Document Command History skeleton 可完成 add/move/remove/undo/redo。
- [ ] Tool-local History 与 Document History 保持分离。
- [ ] GenerationService / taskAdapter 建立。
- [ ] 成功任务结果转换为 Asset，而不是只传播裸 URL。
- [ ] Generation Lineage 能表达分叉与 multi-source 扩展。
- [ ] `ImageWorkstation/index.tsx` 不再承担完整 generation orchestration。
- [ ] Workstation Tool Registry 不管理 Fabric lifecycle。
- [ ] MaskPaintCanvas / OutpaintCanvas 无功能回归。
- [ ] build / lint / editor core tests 通过。
- [ ] 未提前实现完整 Timeline、React Flow 主画布或 WebGL renderer。

---

## 14. Stage 4 入口条件

完成 Stage 3 后进入 FreeCanvas MVP。Stage 4 可以直接消费：

```text
PixelProject
AssetRegistry
GenerationRegistry
EditorNode
Commands
GenerationService
Generation Lineage
```

因此 FreeCanvas 不再重新发明自己的 `resultUrls` / `currentImage` / generation state。

Stage 4 的目标闭环：

```text
Prompt
→ GenerationJob
→ ImageAsset / VideoAsset
→ ImageNode / VideoNode
→ Fabric FreeCanvas
→ transform / compare
→ 从已有 Asset 发起 Variation / Image-to-Video
```

这就是 Stage 3 本次调整的核心价值：**先把领域模型和生成链打通，再扩展画布能力。**