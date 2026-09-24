import { PLATFORM_SIZE_PRESETS } from '@/constants/platformSizes'

export type FitStrategy = 'letterbox' | 'crop' | 'outpaint'
export type BatchStatus = 'pending' | 'processing' | 'succeeded' | 'failed'

export interface SubjectBox {
  x: number
  y: number
  width: number
  height: number
}

export interface SubjectDetection {
  box: SubjectBox | null
}

export interface CropFocus {
  fx: number
  fy: number
  source: 'subject' | 'grid'
  note: string
}

export interface AspectRatioSettings {
  strategy: FitStrategy
  selectedPresetId: string
  background: string
  fx: number
  fy: number
}

export const DEFAULT_ASPECT_RATIO_SETTINGS: AspectRatioSettings = {
  strategy: 'letterbox',
  selectedPresetId: PLATFORM_SIZE_PRESETS[0].id,
  background: '#ffffff',
  fx: 0.5,
  fy: 0.5,
}

export interface BatchImage {
  id: string
  file: File
  sourceMime: 'image/jpeg' | 'image/png' | 'image/webp'
  sourceUrl: string
  width: number
  height: number
  status: BatchStatus
  output?: Blob
  outputMime?: string
  error?: string
  cropFocus?: CropFocus
}

export interface RenderRequest {
  file: File
  settings: AspectRatioSettings
  targetWidth: number
  targetHeight: number
  previewMaxDimension?: number
}

export interface RenderResult {
  blob: Blob
  mimeType: string
  width: number
  height: number
}

export const PREVIEW_MAX_DIMENSION = 800
export const JPEG_QUALITY = 0.92
