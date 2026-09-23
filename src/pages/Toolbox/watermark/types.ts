export type WatermarkKind = 'text' | 'logo'
export type WatermarkLayout = 'single' | 'tile'
export type WatermarkAnchor =
  | 'top-left' | 'top-center' | 'top-right'
  | 'middle-left' | 'middle-center' | 'middle-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'

export interface WatermarkSettings {
  kind: WatermarkKind
  text: string
  color: string
  opacity: number
  textSizePercent: number
  logoSizePercent: number
  marginPercent: number
  layout: WatermarkLayout
  anchor: WatermarkAnchor
  tileGapPercent: number
  tileRotation: number
  logo: Blob | null
  logoName: string | null
}

export const DEFAULT_WATERMARK_SETTINGS: WatermarkSettings = {
  kind: 'text',
  text: '',
  color: '#ffffff',
  opacity: 70,
  textSizePercent: 4,
  logoSizePercent: 20,
  marginPercent: 3,
  layout: 'single',
  anchor: 'bottom-right',
  tileGapPercent: 8,
  tileRotation: -25,
  logo: null,
  logoName: null,
}

export type BatchStatus = 'pending' | 'processing' | 'succeeded' | 'failed'

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
}

export interface RenderRequest {
  file: File
  sourceMime: BatchImage['sourceMime']
  settings: WatermarkSettings
  previewMaxDimension?: number
}

export interface RenderResult {
  blob: Blob
  mimeType: string
  width: number
  height: number
}
