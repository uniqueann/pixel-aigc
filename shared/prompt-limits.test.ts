import { describe, expect, it } from 'vitest'
import { BAILIAN_IMAGEEDIT_PROMPT_MAX, PROMPT_MAX_LENGTH, VIDEO_PROMPT_MAX, promptLimit } from './prompt-limits'
import { FUSION_MODEL_PROMPT_MAX, FUSION_NOTE_MAX, composeFusionPrompt } from './fusion'
import { RELIGHT_MODEL_PROMPT_MAX, RELIGHT_NOTE_MAX, composeRelightPrompt } from './relight'
import { RETOUCH_DIRECTION_IDS, RETOUCH_MODEL_PROMPT_MAX, RETOUCH_NOTE_MAX, composeRetouchPrompt } from './retouch'
import { VARIATION_MODEL_PROMPT_MAX, VARIATION_USER_PROMPT_MAX, composeVariationPrompt } from './variation'

describe('提示词字数上限', () => {
  it('统一上限是 3500，模型更低时保留模型上限', () => {
    expect(PROMPT_MAX_LENGTH).toBe(3500)
    expect(VIDEO_PROMPT_MAX).toBe(PROMPT_MAX_LENGTH)
    expect(BAILIAN_IMAGEEDIT_PROMPT_MAX).toBe(800)
    expect(promptLimit(32000)).toBe(3500)
    expect(promptLimit(4000)).toBe(3500)
    expect(promptLimit(800)).toBe(800)
    expect(promptLimit(0)).toBe(0)
  })

  it('直接发给模型的补充说明收口到 3500，拼上固定句后仍不超过整段预算', () => {
    const cases = [
      ['裂变', VARIATION_USER_PROMPT_MAX, VARIATION_MODEL_PROMPT_MAX, composeVariationPrompt('字'.repeat(VARIATION_USER_PROMPT_MAX))],
      ['融合', FUSION_NOTE_MAX, FUSION_MODEL_PROMPT_MAX, composeFusionPrompt('字'.repeat(FUSION_NOTE_MAX))],
      ['精修', RETOUCH_NOTE_MAX, RETOUCH_MODEL_PROMPT_MAX, composeRetouchPrompt([...RETOUCH_DIRECTION_IDS], '字'.repeat(RETOUCH_NOTE_MAX))],
      ['重新打光', RELIGHT_NOTE_MAX, RELIGHT_MODEL_PROMPT_MAX, composeRelightPrompt({ direction: 'back', quality: 'hard', temperature: 'cool' }, '字'.repeat(RELIGHT_NOTE_MAX))],
    ] as const
    for (const [label, userMax, modelMax, composed] of cases) {
      expect(userMax, label).toBe(PROMPT_MAX_LENGTH)
      expect(composed.length, label).toBeLessThanOrEqual(modelMax)
    }
  })
})
