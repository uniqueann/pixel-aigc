import { describe, expect, it } from 'vitest'
import {
  RETOUCH_DIRECTION_IDS,
  RETOUCH_FIXED_PROMPT,
  RETOUCH_MODEL_PROMPT_MAX,
  RETOUCH_NOTE_MAX,
  RETOUCH_NOTE_PREFIX,
  composeRetouchPrompt,
  retouchHistoryText,
} from './retouch'

describe('精修提示词', () => {
  it('补充说明上限按四个方向都选中来预留', () => {
    const base = composeRetouchPrompt([...RETOUCH_DIRECTION_IDS])
    expect(RETOUCH_NOTE_MAX).toBe(3816)
    expect(base.length + RETOUCH_NOTE_PREFIX.length + RETOUCH_NOTE_MAX).toBe(RETOUCH_MODEL_PROMPT_MAX)
  })

  it('只包含选中的方向，补充说明接在固定句后面', () => {
    const prompt = composeRetouchPrompt(['sharpen', 'blemish', 'sharpen'], '  保留金属拉丝  ')
    expect(prompt.startsWith(RETOUCH_FIXED_PROMPT)).toBe(true)
    expect(prompt).toContain('去瑕疵：')
    expect(prompt).toContain('边缘锐化：')
    expect(prompt.indexOf('去瑕疵：')).toBeLessThan(prompt.indexOf('边缘锐化：'))
    expect(prompt).not.toContain('提亮：')
    expect(prompt).not.toContain('统一质感：')
    expect(prompt.endsWith(`${RETOUCH_NOTE_PREFIX}保留金属拉丝`)).toBe(true)
  })

  it('没有补充说明时不写衔接语', () => {
    expect(composeRetouchPrompt(['brighten'])).not.toContain('补充说明：')
  })

  it('历史记录用方向名称，不带固定句', () => {
    expect(retouchHistoryText(['texture', 'brighten'])).toBe('提亮、统一质感')
    expect(retouchHistoryText(['blemish'], '缝线处')).toBe('去瑕疵。缝线处')
    expect(retouchHistoryText(['blemish'])).not.toContain(RETOUCH_FIXED_PROMPT)
  })
})
