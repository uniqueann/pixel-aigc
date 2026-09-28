import { describe, expect, it } from 'vitest'
import {
  VARIATION_FIXED_PROMPT,
  VARIATION_MODEL_PROMPT_MAX,
  VARIATION_STEER_PREFIX,
  VARIATION_USER_PROMPT_MAX,
  composeVariationPrompt,
} from './variation'

describe('裂变提示词', () => {
  it('用户上限等于模型上限减去固定句和衔接语', () => {
    expect(VARIATION_USER_PROMPT_MAX).toBe(3925)
    expect(VARIATION_FIXED_PROMPT.length + VARIATION_STEER_PREFIX.length + VARIATION_USER_PROMPT_MAX)
      .toBe(VARIATION_MODEL_PROMPT_MAX)
  })

  it('没写补充时只发送固定句', () => {
    expect(composeVariationPrompt()).toBe(VARIATION_FIXED_PROMPT)
    expect(composeVariationPrompt('   ')).toBe(VARIATION_FIXED_PROMPT)
    expect(composeVariationPrompt()).not.toContain('额外要求：')
  })

  it('补充要求接在固定句后面，并声明以补充要求为准', () => {
    const prompt = composeVariationPrompt('只换背景')
    expect(prompt.startsWith(VARIATION_FIXED_PROMPT)).toBe(true)
    expect(prompt).toContain('以额外要求为准')
    expect(prompt.endsWith(`${VARIATION_STEER_PREFIX}只换背景`)).toBe(true)
    expect(composeVariationPrompt('同款换个颜色')).toContain('同款换个颜色')
  })

  it('写满用户上限时整段正好到达模型上限', () => {
    const prompt = composeVariationPrompt('景'.repeat(VARIATION_USER_PROMPT_MAX))
    expect(prompt.length).toBe(VARIATION_MODEL_PROMPT_MAX)
  })
})
