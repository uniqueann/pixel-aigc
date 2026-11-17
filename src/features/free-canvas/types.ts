import type { ReactNode } from 'react'
import type { Asset, GenerationJob, NodeId, Scene, ViewportState } from '@/editor/types'
import type { CapabilityAvailability } from '@/components/capabilityAvailability'
import type { ZOrderAction } from './zOrder'

export interface NodeTransform {
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

export interface NodeTransformUpdate {
  id: NodeId
  transform: NodeTransform
}

export interface CanvasPoint {
  x: number
  y: number
}

export interface FreeCanvasStageProps {
  scene: Scene
  assets: Record<string, Asset>
  generations: Record<string, GenerationJob>
  selectedNodeIds: NodeId[]
  viewport: ViewportState
  canUndo: boolean
  canRedo: boolean
  generationActive: boolean
  variationEnabled?: boolean
  imageToVideoEnabled?: boolean
  imageToVideoState?: CapabilityAvailability
  canDeleteSelection?: boolean
  canDuplicateSelection?: boolean
  /** 选择集无法删除/复制时给用户的原因，例如"含 1 个生成中的占位框"。 */
  selectionBlockedReason?: string
  /** 当前生成任务的阶段（视频才有意义），用来让画布占位框显示"视频转存中"这类阶段。 */
  taskPhase?: { generationId: string; phase: 'submitting' | 'queued' | 'generating' | 'transferring' }
  onSelectNodes: (nodeIds: NodeId[]) => void
  onTransformNodes: (updates: NodeTransformUpdate[]) => void
  onViewportChange: (viewport: ViewportState) => void
  onUndo: () => void
  onRedo: () => void
  onDeleteSelection: () => void
  onDuplicateSelection: () => void
  onReorderSelection: (action: ZOrderAction) => void
  onNodeGenerationAction: (action: 'variation' | 'image-to-video', nodeId: NodeId) => void
  onAssetLoadError: (message: string) => void
  onFilesDropped?: (files: File[], center: CanvasPoint) => void
  onCanvasFocusChange?: (focused: boolean) => void
  /** 画板为空时显示在画布中央的引导（由页面提供文案与回调） */
  emptyState?: ReactNode
  children?: ReactNode
}

export interface FreeCanvasStageHandle {
  getViewportCenter: () => CanvasPoint
  getCanvasPoint: (clientX: number, clientY: number) => CanvasPoint
  /** 指针最近一次在画布上的位置（画板坐标）；指针还没进过画布时返回 undefined。 */
  getPointerCanvasPoint: () => CanvasPoint | undefined
  revealBounds: (targets: import('./geometry').NodeBounds[]) => void
  fitToScene: () => void
  zoomTo: (zoom: number) => void
}
