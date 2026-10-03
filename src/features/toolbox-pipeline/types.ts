import type { ImageMime } from '@shared/image-format'
import type { AspectRatioSettings, CropFocus } from '@/pages/Toolbox/aspect-ratio/types'
import type { WatermarkSettings } from '@/pages/Toolbox/watermark/types'

export interface PipelineArtifact {
  blob: Blob
  mimeType: 'image/png' | 'image/jpeg'
  width: number
  height: number
}

export interface PipelineSettings {
  aspectRatio: AspectRatioSettings & { strategy: 'letterbox' | 'crop' }
  watermarkEnabled: boolean
  watermark: WatermarkSettings
}

export type StepStatus = 'pending' | 'processing' | 'succeeded' | 'failed'
export interface PipelineItem {
  id: string
  file: File
  sourceMime: ImageMime
  width: number
  height: number
  ratioStatus: StepStatus
  watermarkStatus: StepStatus | 'skipped'
  intermediate?: PipelineArtifact
  output?: PipelineArtifact
  cropFocus?: CropFocus
  phase?: 'detect' | 'ratio' | 'watermark' | 'encode'
  failedStep?: 'ratio' | 'watermark'
  error?: string
}

export function itemStatus(item: PipelineItem): StepStatus {
  if (item.ratioStatus === 'failed' || item.watermarkStatus === 'failed') return 'failed'
  if (item.ratioStatus === 'processing' || item.watermarkStatus === 'processing') return 'processing'
  if (item.output && (item.watermarkStatus === 'succeeded' || item.watermarkStatus === 'skipped')) return 'succeeded'
  return 'pending'
}

export function finalMime(item: Pick<PipelineItem, 'sourceMime'>, settings: PipelineSettings): PipelineArtifact['mimeType'] {
  const ratio = settings.aspectRatio
  if (ratio.strategy === 'letterbox') return ratio.background === 'transparent' ? 'image/png' : 'image/jpeg'
  return item.sourceMime === 'image/jpeg' ? 'image/jpeg' : 'image/png'
}

export function invalidateRatio(item: PipelineItem): PipelineItem {
  return { ...item, ratioStatus: 'pending', watermarkStatus: 'pending', intermediate: undefined,
    output: undefined, cropFocus: undefined, phase: undefined, error: undefined, failedStep: undefined }
}

export function invalidateWatermark(item: PipelineItem): PipelineItem {
  return { ...item, watermarkStatus: 'pending', output: undefined, phase: undefined,
    error: item.failedStep === 'ratio' ? item.error : undefined,
    failedStep: item.failedStep === 'ratio' ? 'ratio' : undefined }
}
