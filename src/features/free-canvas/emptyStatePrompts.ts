import { i18n } from '@/i18n'
import zhCanvas from '@/i18n/locales/zh-CN/canvas.json'

const IMAGE_PROMPT_KEYS = [
  'canvas:emptyState.imagePrompts.neonStreet',
  'canvas:emptyState.imagePrompts.minimalProduct',
  'canvas:emptyState.imagePrompts.morningCafe',
] as const

const VIDEO_PROMPT_KEYS = [
  'canvas:emptyState.videoPrompts.leafZoom',
  'canvas:emptyState.videoPrompts.rainNeon',
  'canvas:emptyState.videoPrompts.cityAerial',
] as const

/** 空白画布的示例描述：点一下直接填进画面描述，不消耗任何东西。 */
export const IMAGE_EXAMPLE_PROMPTS = [
  zhCanvas.emptyState.imagePrompts.neonStreet,
  zhCanvas.emptyState.imagePrompts.minimalProduct,
  zhCanvas.emptyState.imagePrompts.morningCafe,
] as const

/** 视频模式给运动描述，比静物示例更贴切。 */
export const VIDEO_EXAMPLE_PROMPTS = [
  zhCanvas.emptyState.videoPrompts.leafZoom,
  zhCanvas.emptyState.videoPrompts.rainNeon,
  zhCanvas.emptyState.videoPrompts.cityAerial,
] as const

export function localizeExamplePrompt(prompt: string): string {
  const imageIndex = (IMAGE_EXAMPLE_PROMPTS as readonly string[]).indexOf(prompt)
  if (imageIndex >= 0) return i18n.t(IMAGE_PROMPT_KEYS[imageIndex])
  const videoIndex = (VIDEO_EXAMPLE_PROMPTS as readonly string[]).indexOf(prompt)
  if (videoIndex >= 0) return i18n.t(VIDEO_PROMPT_KEYS[videoIndex])
  return prompt
}
