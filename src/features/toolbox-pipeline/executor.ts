import { PLATFORM_SIZE_PRESETS } from '@/constants/platformSizes'
import { cropFocusForImage } from '@/pages/Toolbox/aspect-ratio/subjectFocus'
import type { RenderRequest as RatioRequest, RenderResult, SubjectDetection } from '@/pages/Toolbox/aspect-ratio/types'
import type { RenderRequest as WatermarkRequest } from '@/pages/Toolbox/watermark/types'
import { DEFAULT_WATERMARK_SETTINGS } from '@/pages/Toolbox/watermark/types'
import { hasWatermark } from '@/pages/Toolbox/watermark/validation'
import { finalMime, itemStatus, type PipelineArtifact, type PipelineItem, type PipelineSettings } from './types'

export interface PipelineProcessors {
  detect: (item: PipelineItem) => Promise<SubjectDetection>
  renderRatio: (request: RatioRequest) => Promise<RenderResult>
  renderWatermark: (request: WatermarkRequest) => Promise<RenderResult>
}

function artifact(result: RenderResult, width: number, height: number, mime: PipelineArtifact['mimeType']): PipelineArtifact {
  if (result.width !== width || result.height !== height) throw new Error('输出尺寸与目标平台不一致')
  if (!result.blob.size || (result.blob.type || result.mimeType) !== mime) throw new Error('图片编码格式与预期不一致')
  return { ...result, mimeType: mime }
}

export function validatePipeline(settings: PipelineSettings) {
  if (!['letterbox', 'crop'].includes(settings.aspectRatio.strategy)) throw new Error('流水线仅支持留白填充与智能裁剪')
  if (!PLATFORM_SIZE_PRESETS.some(preset => preset.id === settings.aspectRatio.selectedPresetId)) throw new Error('请选择有效的目标平台')
  if (settings.watermarkEnabled && !hasWatermark(settings.watermark)) throw new Error('请先填写水印文字或选择 Logo')
}

/** 每张图片从最近的成功步骤继续，步骤之间只传递真实结果。 */
export async function executePipeline(input: PipelineProcessors & {
  items: PipelineItem[]
  settings: PipelineSettings
  update: (id: string, patch: Partial<PipelineItem>) => void
  isStopped: () => boolean
}) {
  const { items, settings, detect, renderRatio, renderWatermark, update, isStopped } = input
  validatePipeline(settings)
  const preset = PLATFORM_SIZE_PRESETS.find(value => value.id === settings.aspectRatio.selectedPresetId)!
  for (const item of items) {
    if (isStopped()) return
    if (itemStatus(item) === 'succeeded') continue
    let intermediate = item.intermediate
    let failedStep: 'ratio' | 'watermark' = intermediate && item.ratioStatus === 'succeeded' ? 'watermark' : 'ratio'
    try {
      if (failedStep === 'ratio') {
        update(item.id, { ratioStatus: 'processing', phase: settings.aspectRatio.strategy === 'crop' ? 'detect' : 'ratio', error: undefined, failedStep: undefined })
        const cropFocus = await cropFocusForImage(item, settings.aspectRatio, preset.width, preset.height, () => detect(item))
        if (isStopped()) return
        update(item.id, { phase: 'ratio', cropFocus })
        const rendered = await renderRatio({ file: item.file,
          settings: cropFocus ? { ...settings.aspectRatio, fx: cropFocus.fx, fy: cropFocus.fy } : settings.aspectRatio,
          targetWidth: preset.width, targetHeight: preset.height, outputMime: 'image/png' })
        if (isStopped()) return
        intermediate = artifact(rendered, preset.width, preset.height, 'image/png')
        update(item.id, { ratioStatus: 'succeeded', intermediate, cropFocus, phase: undefined })
      }
      failedStep = 'watermark'
      const source = intermediate!
      const mime = finalMime(item, settings)
      update(item.id, { watermarkStatus: 'processing', phase: settings.watermarkEnabled ? 'watermark' : 'encode', error: undefined, failedStep: undefined })
      let output = source
      if (settings.watermarkEnabled || mime !== source.mimeType) {
        const result = await renderWatermark({
          file: new File([source.blob], item.file.name, { type: source.mimeType }),
          sourceMime: source.mimeType, outputMime: mime,
          settings: settings.watermarkEnabled ? settings.watermark : { ...DEFAULT_WATERMARK_SETTINGS },
        })
        if (isStopped()) return
        output = artifact(result, source.width, source.height, mime)
      }
      if (isStopped()) return
      update(item.id, { output, watermarkStatus: settings.watermarkEnabled ? 'succeeded' : 'skipped', phase: undefined, error: undefined, failedStep: undefined })
    } catch (error) {
      if (isStopped()) return
      update(item.id, { [failedStep === 'ratio' ? 'ratioStatus' : 'watermarkStatus']: 'failed',
        failedStep, phase: undefined, output: undefined,
        error: `${failedStep === 'ratio' ? '转比例' : settings.watermarkEnabled ? '加水印' : '成品编码'}失败：${error instanceof Error ? error.message : '图片处理失败'}` })
    }
  }
}
