/** 模型整段提示词上限。用户可见上限要扣掉固定句和衔接语。 */
export const VARIATION_MODEL_PROMPT_MAX = 4000

export const VARIATION_FIXED_PROMPT = '基于原图再生成一版不同的电商主图，商品保持可识别。没有额外要求时，优先更换场景或构图。不要添加文字和水印。若写了额外要求，以额外要求为准。'

export const VARIATION_STEER_PREFIX = '\n额外要求：'

export const VARIATION_USER_PROMPT_MAX = VARIATION_MODEL_PROMPT_MAX
  - VARIATION_FIXED_PROMPT.length
  - VARIATION_STEER_PREFIX.length

export function variationPromptLimitMessage() {
  return `补充要求最多 ${VARIATION_USER_PROMPT_MAX} 字`
}

/** 固定句只约束没写补充时的默认行为。补充要求与固定句冲突时，以补充要求为准。 */
export function composeVariationPrompt(steer?: string) {
  const extra = steer?.trim()
  if (!extra) return VARIATION_FIXED_PROMPT
  return `${VARIATION_FIXED_PROMPT}${VARIATION_STEER_PREFIX}${extra}`
}
