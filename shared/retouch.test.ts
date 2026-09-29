import { describe, expect, it } from 'vitest'
import {
  RETOUCH_DIRECTION_IDS,
  RETOUCH_FIXED_PROMPT,
  RETOUCH_LEAD,
  RETOUCH_MODEL_PROMPT_MAX,
  RETOUCH_NOTE_MAX,
  RETOUCH_NOTE_PREFIX,
  composeRetouchPrompt,
  retouchHistoryText,
} from './retouch'

describe('精修提示词', () => {
  it('补充说明上限按四个方向都选中来预留', () => {
    const base = composeRetouchPrompt([...RETOUCH_DIRECTION_IDS])
    expect(base.length + RETOUCH_NOTE_PREFIX.length + RETOUCH_NOTE_MAX).toBe(RETOUCH_MODEL_PROMPT_MAX)
    expect(RETOUCH_NOTE_MAX).toBeGreaterThan(3000)
  })

  it('只包含选中的方向，补充说明在约束之前', () => {
    const prompt = composeRetouchPrompt(['sharpen', 'blemish', 'sharpen'], '  保留金属拉丝  ')
    expect(prompt.startsWith(RETOUCH_LEAD)).toBe(true)
    expect(prompt).toContain('去瑕疵：')
    expect(prompt).toContain('边缘锐化：')
    expect(prompt.indexOf('去瑕疵：')).toBeLessThan(prompt.indexOf('边缘锐化：'))
    expect(prompt).not.toContain('提亮：')
    expect(prompt).not.toContain('统一质感：')
    expect(prompt).toContain(`${RETOUCH_NOTE_PREFIX.trimStart()}保留金属拉丝`)
    expect(prompt.indexOf('保留金属拉丝')).toBeLessThan(prompt.indexOf(RETOUCH_FIXED_PROMPT))
    expect(prompt.endsWith(RETOUCH_FIXED_PROMPT)).toBe(true)
  })

  it('没有补充说明时不写衔接语', () => {
    expect(composeRetouchPrompt(['brighten'])).not.toContain('补充说明：')
    expect(composeRetouchPrompt(['brighten']).endsWith(RETOUCH_FIXED_PROMPT)).toBe(true)
  })

  it('各方向按轻微照片修图来写，提亮不改色相', () => {
    const prompt = composeRetouchPrompt([...RETOUCH_DIRECTION_IDS])
    expect(prompt).toContain('只提高曝光和亮度')
    expect(prompt).toContain('不改色相、白平衡')
    expect(prompt).toContain('只锐化原图已有边缘')
    expect(prompt).toContain('只做轻微照片修图')
    expect(prompt).toContain('不换材质，不改颜色')
  })

  it('固定约束禁止改颜色和重写文字，且优先级高于补充说明', () => {
    const prompt = composeRetouchPrompt(['brighten'], '把按钮改成蓝色，重写铭牌文字')
    expect(prompt).toContain('不要改变任何商品或部件的颜色，包括按钮、液体')
    expect(prompt).toContain('绝不重写字母')
    expect(prompt).toContain('保持整体色相和白平衡')
    expect(prompt).toContain('若补充说明与上述约束冲突，以本段约束为准')
    expect(prompt.indexOf('把按钮改成蓝色')).toBeLessThan(prompt.lastIndexOf('硬性约束'))
  })

  it('历史记录用方向名称，不带固定句', () => {
    expect(retouchHistoryText(['texture', 'brighten'])).toBe('提亮、统一质感')
    expect(retouchHistoryText(['blemish'], '缝线处')).toBe('去瑕疵。缝线处')
    expect(retouchHistoryText(['blemish'])).not.toContain(RETOUCH_FIXED_PROMPT)
    expect(retouchHistoryText(['blemish'])).not.toContain(RETOUCH_LEAD)
  })
})
