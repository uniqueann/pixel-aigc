import type { Asset, GenerationJob, NodeId, Scene, ViewportState } from '@/editor/types'

export interface NodeTransform {
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

export interface FreeCanvasStageProps {
  scene: Scene
  assets: Record<string, Asset>
  generations: Record<string, GenerationJob>
  selectedNodeId?: NodeId
  viewport: ViewportState
  canUndo: boolean
  canRedo: boolean
  onSelectNode: (nodeId?: NodeId) => void
  onTransformNode: (nodeId: NodeId, transform: NodeTransform) => void
  onViewportChange: (viewport: ViewportState) => void
  onUndo: () => void
  onRedo: () => void
  onDelete: () => void
  onAssetLoadError: (message: string) => void
}

export interface FreeCanvasStageHandle {
  getViewportCenter: () => { x: number; y: number }
}
