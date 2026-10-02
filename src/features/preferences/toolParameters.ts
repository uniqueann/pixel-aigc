import { RELIGHT_DEFAULT, type RelightOptions } from '@shared/relight'
import type { RetouchDirection } from '@shared/retouch'
import { defaultImageModel, mapDragonCodeSize, type ImageModelUi } from '@shared/image-models'
import { COUNT_TOOLS, type CountTool, type ImageMemoryTool, type PersonalizationPreferences } from '@shared/preferences'
import { DEFAULT_ASPECT_RATIO_SETTINGS, type AspectRatioSettings } from '@/pages/Toolbox/aspect-ratio/types'
import { DEFAULT_BG_REMOVE_SETTINGS, type BgRemoveSettings } from '@/pages/Toolbox/bg-remove/types'
import { DEFAULT_WATERMARK_SETTINGS, type WatermarkSettings } from '@/pages/Toolbox/watermark/types'

export interface WorkstationParameters {
  count: number
  resolution: '1k' | '2k' | '4k'
  retouchDirections: RetouchDirection[]
  relight: RelightOptions
  outpaintMode: 'free' | 'preset'
  outpaintOutputMode: 'original' | 'platform'
  presetPlatform: string
}
export function initialWorkstationParameters(preferences: PersonalizationPreferences, tool: string): WorkstationParameters {
  const remembered = preferences.image.rememberParameters ? preferences.image.lastUsed : {}
  const counted = COUNT_TOOLS.includes(tool as CountTool) ? tool as CountTool : undefined
  const memory = counted ? remembered[counted] : undefined
  return {
    count: memory?.count ?? (counted ? preferences.image.counts[counted] : 1),
    resolution: memory?.resolution ?? preferences.image.resolution,
    retouchDirections: tool === 'retouch' ? remembered.retouch?.retouchDirections ?? [] : [],
    relight: tool === 'relight' ? remembered.relight?.relight ?? { ...RELIGHT_DEFAULT } : { ...RELIGHT_DEFAULT },
    outpaintMode: tool === 'outpaint' ? remembered.outpaint?.outpaintMode ?? 'free' : 'free',
    outpaintOutputMode: tool === 'outpaint' ? remembered.outpaint?.outpaintOutputMode ?? 'original' : 'original',
    presetPlatform: tool === 'outpaint' ? remembered.outpaint?.presetPlatform ?? 'amazon' : 'amazon',
  }
}

/** 只调整本次有效值，避免受限图片覆盖用户的高分辨率偏好。 */
export function effectiveImageParameters(count: number, resolution: '1k' | '2k' | '4k', source?: { width: number; height: number }, ui?: ImageModelUi) {
  const supported = ui ?? defaultImageModel('image_edit')!.ui
  const effectiveCount = Math.min(supported.maxCount, Math.max(1, Math.round(count)))
  let effectiveResolution = supported.resolutions.includes(resolution) ? resolution
    : supported.resolutions.includes('2k') ? '2k' as const : supported.resolutions[0]
  if (source && effectiveResolution === '4k' && supported.resolutionRatioConstraints?.['4k']) {
    const mapped = mapDragonCodeSize(source.width, source.height, effectiveResolution)
    if (!supported.resolutionRatioConstraints['4k'].includes(mapped.size)) effectiveResolution = supported.resolutions.includes('2k') ? '2k' : supported.resolutions[0]
  }
  return { count: effectiveCount, resolution: effectiveResolution }
}

export function toolboxMemory(preferences: PersonalizationPreferences, tool: ImageMemoryTool) {
  return preferences.image.rememberParameters ? preferences.image.lastUsed[tool] : undefined
}
export function initialBgRemoveSettings(preferences: PersonalizationPreferences): BgRemoveSettings {
  return { ...DEFAULT_BG_REMOVE_SETTINGS, ...(preferences.image.rememberParameters ? preferences.image.lastUsed['bg-remove'] : {}) }
}
export function initialAspectRatioSettings(preferences: PersonalizationPreferences): AspectRatioSettings {
  return { ...DEFAULT_ASPECT_RATIO_SETTINGS, ...(preferences.image.rememberParameters ? preferences.image.lastUsed['aspect-ratio'] : {}) }
}
export function initialWatermarkSettings(preferences: PersonalizationPreferences): WatermarkSettings {
  return { ...DEFAULT_WATERMARK_SETTINGS, ...(preferences.image.rememberParameters ? preferences.image.lastUsed.watermark : {}) }
}
export function aspectRatioMemory(settings: AspectRatioSettings) {
  const { strategy, selectedPresetId, background, outpaintOutputMode } = settings
  return { strategy, selectedPresetId, background, outpaintOutputMode }
}
export function watermarkMemory(settings: WatermarkSettings) {
  const { text, color, opacity, textSizePercent, logoSizePercent, marginPercent, layout, anchor, tileGapPercent, tileRotation } = settings
  return { text, color, opacity, textSizePercent, logoSizePercent, marginPercent, layout, anchor, tileGapPercent, tileRotation }
}
