import { describe, expect, it } from 'vitest'
import { PROMPT_MAX_LENGTH } from './prompt-limits'
import {
  VARIATION_FIXED_PROMPT,
  VARIATION_MODEL_PROMPT_MAX,
  VARIATION_STEER_PREFIX,
  VARIATION_USER_PROMPT_MAX,
  composeVariationPrompt,
} from './variation'

describe('裂变提示词', () => {
  it('用户上限收口到统一上限，且不超过模型预算减去固定句', () => {
    const reserved = VARIATION_FIXED_PROMPT.length + VARIATION_STEER_PREFIX.length
    expect(VARIATION_USER_PROMPT_MAX).toBe(PROMPT_MAX_LENGTH)
    expect(reserved + VARIATION_USER_PROMPT_MAX).toBeLessThanOrEqual(VARIATION_MODEL_PROMPT_MAX)
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

  it('写满用户上限时整段不超过模型预算', () => {
    const prompt = composeVariationPrompt('景'.repeat(VARIATION_USER_PROMPT_MAX))
    expect(prompt.length).toBe(VARIATION_FIXED_PROMPT.length + VARIATION_STEER_PREFIX.length + VARIATION_USER_PROMPT_MAX)
    expect(prompt.length).toBeLessThanOrEqual(VARIATION_MODEL_PROMPT_MAX)
  })
})
