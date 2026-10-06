import type { PublicImageModel } from '@/services/api/imageModels'
import { effectiveImageParameters } from '@/features/preferences/toolParameters'
import { IMAGE_SIZE_PRESETS } from './config'

type Resolution = '1k' | '2k' | '4k'

interface TextToImageDraftInput {
  presetKey: string
  count: number
  resolution?: Resolution | '720p'
  modelProfileId?: string
}

export function availableTextToImagePresets(model?: PublicImageModel) {
  const ratios = model?.ui.sizeMode === 'ratio' ? model.ui.ratios : undefined
  return IMAGE_SIZE_PRESETS.filter(preset => !ratios?.length || ratios.includes(preset.key))
}

/** 保留草稿期望值，只为本次请求推导模型支持的比例、数量、分辨率和报价。 */
export function resolveCanvasTextToImageParameters(draft: TextToImageDraftInput, defaultResolution: Resolution, models: PublicImageModel[]) {
  const model = models.find(item => item.id === draft.modelProfileId)
    ?? models.find(item => item.defaultFor?.includes('text_to_image')) ?? models[0]
  const presets = availableTextToImagePresets(model)
  const preset = presets.find(item => item.key === draft.presetKey) ?? presets[0] ?? IMAGE_SIZE_PRESETS[0]
  const requestedResolution = draft.resolution && draft.resolution !== '720p' ? draft.resolution : defaultResolution
  const effective = effectiveImageParameters(Math.min(4, draft.count), requestedResolution, preset, model?.ui)
  const creditsPerImage = model?.pricing?.creditsPerImage?.[effective.resolution]
  const pricingReady = typeof creditsPerImage === 'number' && Number.isFinite(creditsPerImage) && creditsPerImage >= 0
  return {
    model, preset, presets, requestedResolution, ...effective,
    pricingReady,
    estimatedCredits: pricingReady ? effective.count * creditsPerImage : undefined,
    resolutionAdjusted: effective.resolution !== requestedResolution,
    ratioAdjusted: preset.key !== draft.presetKey,
    countAdjusted: effective.count !== draft.count,
  }
}
