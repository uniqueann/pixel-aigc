export type BatchStatus = 'pending' | 'processing' | 'succeeded' | 'failed'

export interface BgRemoveSettings {
  background: string
}

export const DEFAULT_BG_REMOVE_SETTINGS: BgRemoveSettings = {
  background: '#ffffff',
}

export interface BatchImage {
  id: string
  file: File
  sourceMime: 'image/jpeg' | 'image/png' | 'image/webp'
  sourceUrl: string
  width: number
  height: number
  status: BatchStatus
  matte?: Blob
  output?: Blob
  outputMime?: string
  error?: string
}

export const PREVIEW_MAX_DIMENSION = 800
export const JPEG_QUALITY = 0.92
export const BG_REMOVE_CONCURRENCY = 3
