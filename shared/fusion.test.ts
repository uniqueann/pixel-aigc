import { describe, expect, it } from 'vitest'
import {
  FUSION_FIXED_PROMPT,
  FUSION_MODEL_PROMPT_MAX,
  FUSION_NOTE_MAX,
  FUSION_NOTE_PREFIX,
  composeFusionPrompt,
  fusionHistoryText,
  readReferenceImageKey,
} from './fusion'

describe('融合提示词', () => {
  it('补充说明上限等于模型上限减去固定句和衔接语', () => {
    expect(FUSION_NOTE_MAX).toBe(3889)
    expect(FUSION_FIXED_PROMPT.length + FUSION_NOTE_PREFIX.length + FUSION_NOTE_MAX).toBe(FUSION_MODEL_PROMPT_MAX)
  })

  it('补充说明接在固定句后面，空说明不写衔接语', () => {
    expect(composeFusionPrompt()).toBe(FUSION_FIXED_PROMPT)
    expect(composeFusionPrompt('  放在桌面中央  ').endsWith(`${FUSION_NOTE_PREFIX}放在桌面中央`)).toBe(true)
    expect(composeFusionPrompt('放在桌面中央').startsWith(FUSION_FIXED_PROMPT)).toBe(true)
  })

  it('历史说明只保留用户补充', () => {
    expect(fusionHistoryText('  放在桌面中央  ')).toBe('放在桌面中央')
    expect(fusionHistoryText('   ')).toBeUndefined()
    expect(fusionHistoryText('放在桌面中央')).not.toContain(FUSION_FIXED_PROMPT)
  })

  it('从任务参数读取场景图对象', () => {
    expect(readReferenceImageKey({ referenceImageKey: ' generated/user/scene ' })).toBe('generated/user/scene')
    expect(readReferenceImageKey({ prompt: '只要商品' })).toBeUndefined()
  })
})
