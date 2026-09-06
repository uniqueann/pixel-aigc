import type { ImageAsset } from '@/editor/types'
import type { Capability, ImageTaskParams, InpaintTaskParams, OutpaintTaskParams } from '@/types'

export type InteractionMode = 'params-only' | 'mask-paint' | 'drag-resize' | 'multi-source' | 'light-control'

export interface ValidationResult {
  valid: boolean
  message?: string
}

export interface WorkstationContext {
  sourceAsset: ImageAsset
  prompt?: string
  maskUrl?: string
  targetSize?: { width: number; height: number }
  originOffset?: { x: number; y: number }
}

export interface WorkstationGenerationRequest {
  capability: Capability
  params: ImageTaskParams | InpaintTaskParams | OutpaintTaskParams
  outputSize: { width: number; height: number }
}

export interface WorkstationToolDefinition {
  slug: string
  label: string
  capability: Capability
  interactionMode: InteractionMode
  validate?: (ctx: WorkstationContext) => ValidationResult
  buildRequest: (ctx: WorkstationContext) => WorkstationGenerationRequest
}

export interface WorkstationCanvasHandle {
  exportMask: () => { maskDataUrl: string }
  getTargetSize?: () => { width: number; height: number }
  getOriginOffset?: () => { x: number; y: number }
}
