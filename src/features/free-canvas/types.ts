import type { ReactNode } from 'react'
import type { Asset, GenerationJob, NodeId, Scene, ViewportState } from '@/editor/types'
import type { CapabilityAvailability } from '@/components/capabilityAvailability'

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
  generationActive: boolean
  variationEnabled?: boolean
  imageToVideoEnabled?: boolean
  imageToVideoState?: CapabilityAvailability
  onSelectNode: (nodeId?: NodeId) => void
  onTransformNode: (nodeId: NodeId, transform: NodeTransform) => void
  onViewportChange: (viewport: ViewportState) => void
  onUndo: () => void
  onRedo: () => void
  onDelete: () => void
  onNodeGenerationAction: (action: 'variation' | 'image-to-video', nodeId: NodeId) => void
  onAssetLoadError: (message: string) => void
  children?: ReactNode
}

export interface FreeCanvasStageHandle {
  getViewportCenter: () => { x: number; y: number }
  revealBounds: (targets: import('./geometry').NodeBounds[]) => void
}
