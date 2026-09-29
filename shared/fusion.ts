export const FUSION_MODEL_PROMPT_MAX = 4000

export const FUSION_FIXED_PROMPT = '第一张图是要保留的商品。第二张图只提供场景或参考。保持商品的形状、颜色、表面纹理、印刷文字和 Logo 不变，不要把场景里的物体画进商品。不改商品本身，不加文字和水印。若补充说明与上述约束冲突，以本段约束为准。'

export const FUSION_NOTE_PREFIX = '\n补充说明：'

export const FUSION_NOTE_MAX = FUSION_MODEL_PROMPT_MAX - FUSION_FIXED_PROMPT.length - FUSION_NOTE_PREFIX.length

export function fusionNoteLimitMessage() {
  return `补充说明最多 ${FUSION_NOTE_MAX} 字`
}

export function composeFusionPrompt(note?: string) {
  const extra = note?.trim()
  if (!extra) return FUSION_FIXED_PROMPT
  return `${FUSION_FIXED_PROMPT}${FUSION_NOTE_PREFIX}${extra}`
}

export function fusionHistoryText(note?: string) {
  const extra = note?.trim()
  return extra || undefined
}

export function readReferenceImageKey(params: unknown) {
  if (!params || typeof params !== 'object' || !('referenceImageKey' in params)) return undefined
  const value = (params as { referenceImageKey?: unknown }).referenceImageKey
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
