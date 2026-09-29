import { describe, expect, it } from 'vitest'
import {
  RELIGHT_FIXED_PROMPT,
  RELIGHT_MODEL_PROMPT_MAX,
  RELIGHT_NOTE_MAX,
  RELIGHT_NOTE_PREFIX,
  composeRelightPrompt,
  readRelight,
  relightHistoryText,
  relightOptionLine,
} from './relight'

describe('重新打光提示词', () => {
  it('补充说明上限按最长光效预留', () => {
    const longest = [
      '只调整这张商品图的光线，不要重绘商品本身。',
      relightOptionLine({ direction: 'back', quality: 'hard', temperature: 'neutral' }),
      RELIGHT_FIXED_PROMPT,
    ].join('\n')
    expect(RELIGHT_NOTE_MAX).toBe(3853)
    expect(longest.length + RELIGHT_NOTE_PREFIX.length + RELIGHT_NOTE_MAX).toBe(RELIGHT_MODEL_PROMPT_MAX)
  })

  it('硬性约束在补充说明后面，暖色仍禁止改商品颜色', () => {
    const prompt = composeRelightPrompt(
      { direction: 'left', quality: 'soft', temperature: 'warm' },
      '  略提亮背景  ',
    )
    expect(prompt).toContain('光从左侧来。柔光。暖色调。')
    expect(prompt).toContain('不改变商品固有颜色')
    expect(prompt.indexOf('补充说明：略提亮背景')).toBeLessThan(prompt.indexOf(RELIGHT_FIXED_PROMPT))
    expect(prompt.endsWith(RELIGHT_FIXED_PROMPT)).toBe(true)
  })

  it('没有补充说明时不写衔接语', () => {
    const prompt = composeRelightPrompt({ direction: 'front', quality: 'soft', temperature: 'neutral' })
    expect(prompt).not.toContain('补充说明：')
    expect(prompt.endsWith(RELIGHT_FIXED_PROMPT)).toBe(true)
  })

  it('历史记录用中文选项，不保存整段约束', () => {
    const options = { direction: 'left' as const, quality: 'soft' as const, temperature: 'warm' as const }
    expect(relightHistoryText(options)).toBe('左侧、柔光、暖色')
    expect(relightHistoryText(options, '略提亮背景')).toBe('左侧、柔光、暖色。略提亮背景')
    expect(relightHistoryText(options)).not.toContain(RELIGHT_FIXED_PROMPT)
    expect(readRelight({ relight: options })).toEqual(options)
    expect(readRelight({ prompt: '只要商品' })).toBeUndefined()
  })
})
