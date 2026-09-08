import type { ImageNode, PixelProject } from '@/editor/types'
import type { CanvasGenerationRequest } from '@/features/free-canvas/generation/requestBuilder'
import type { GenerationPlacement } from '@/features/free-canvas/geometry'

export interface GenerationContext {
  inputAssetIds: string[]
  parentGenerationId?: string
  retryOfGenerationId?: string
  autoRetryRemaining: number
  automaticRetry: boolean
}

export interface GenerationRecovery {
  projectId: string
  sceneId: string
  request: CanvasGenerationRequest
  context: GenerationContext
  placements: GenerationPlacement[]
  replacedPlaceholderIds: string[]
  backendTaskId?: string
  applied: boolean
  abandoned?: boolean
}

export interface GenerationDraft {
  prompt: string
  presetKey: string
  count: number
  durationSeconds: number
}

export interface CanvasDrafts {
  'text-to-image': GenerationDraft
  'text-to-video': GenerationDraft
  derived?: {
    mode: 'variation' | 'image-to-video'
    sourceNode: ImageNode
    sourceAssetId: string
    prompt: string
    count: number
    durationSeconds: number
  }
}

export interface ProjectSnapshot {
  schemaVersion: 1
  project: PixelProject
  drafts: CanvasDrafts
  recoveries: Record<string, GenerationRecovery>
}

export function defaultDrafts(): CanvasDrafts {
  const draft = { prompt: '', presetKey: '1:1', count: 1, durationSeconds: 5 }
  return { 'text-to-image': { ...draft }, 'text-to-video': { ...draft } }
}
