import type { ImageAsset } from '@/editor/types'
import type {
  Capability,
  ImageEditTaskParams,
  ImageTaskParams,
  InpaintTaskParams,
  OutpaintTaskParams,
  VariationTaskParams,
} from '@/types'

export type InteractionMode = 'params-only' | 'mask-paint' | 'drag-resize' | 'multi-source' | 'light-control'

export interface ValidationResult {
  valid: boolean
  message?: string
}

export interface WorkstationContext {
  sourceAsset: ImageAsset
  prompt?: string
  retouchDirections?: Array<'blemish' | 'brighten' | 'sharpen' | 'texture'>
  referenceAsset?: ImageAsset
  relight?: {
    direction: 'left' | 'right' | 'top' | 'bottom' | 'front' | 'back' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
    quality: 'soft' | 'hard'
    temperature: 'warm' | 'neutral' | 'cool'
  }
  count?: number
  resolution?: '1k' | '2k' | '4k'
  modelProfileId?: string
  /** 所选模型的提示词上限。重新打光用来截断补充说明。 */
  promptMaxLength?: number
  maskUrl?: string
  targetSize?: { width: number; height: number }
  originOffset?: { x: number; y: number }
}

export interface WorkstationGenerationRequest {
  capability: Capability
  params: ImageTaskParams | ImageEditTaskParams | InpaintTaskParams | OutpaintTaskParams | VariationTaskParams
  outputSize: { width: number; height: number }
  modelProfileId?: string
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
  getSourceSize?: () => { width: number; height: number }
}
