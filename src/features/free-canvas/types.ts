import type { Asset, NodeId, Scene, ViewportState } from '@/editor/types'

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
