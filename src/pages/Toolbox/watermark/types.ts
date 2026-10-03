export type WatermarkKind = 'text' | 'logo'
export type WatermarkLayout = 'single' | 'tile'
export type WatermarkColorMode = 'auto' | 'custom'
export type WatermarkAnchor =
  | 'top-left' | 'top-center' | 'top-right'
  | 'middle-left' | 'middle-center' | 'middle-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'

export interface WatermarkSettings {
  kind: WatermarkKind
  text: string
  /** 自定义颜色。自动模式下仍保留，切回自定义时继续使用。 */
  color: string
  /** 自动按水印区域明暗选择黑白字；自定义沿用 color。 */
  colorMode: WatermarkColorMode
  /** 对比色细描边，随字号缩放。 */
  readability: boolean
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
  colorMode: 'auto',
  readability: true,
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

/**
 * 补齐旧模板缺少的字段。
 * 没有 colorMode 的已保存设置继续使用原来的颜色，避免把已存的白字改成自动。
 * 全新默认值才使用自动。可读性描边缺省为开启。
 */
export function migrateWatermarkSettings(saved?: Partial<WatermarkSettings> | null): WatermarkSettings {
  const source = saved ?? {}
  const colorMode = source.colorMode === 'auto' || source.colorMode === 'custom' ? source.colorMode : 'custom'
  return {
    ...DEFAULT_WATERMARK_SETTINGS,
    ...source,
    colorMode,
    readability: typeof source.readability === 'boolean' ? source.readability : true,
    logo: source.logo ?? null,
    logoName: source.logoName ?? null,
  }
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
  outputMime?: 'image/png' | 'image/jpeg'
}

export interface RenderResult {
  blob: Blob
  mimeType: string
  width: number
  height: number
}
