import { describe, expect, it } from 'vitest'
import { createImageAsset } from '@/editor/services/assetService'
import { Capability } from '@/types'
import { PROMPT_MAX_LENGTH } from '@shared/prompt-limits'
import { RELIGHT_DEFAULT, composeRelightPrompt, fitRelightNote } from '@shared/relight'
import { buildRelightRequest } from './relight'

describe('buildRelightRequest', () => {
  it('默认两张，并带上默认光效', () => {
    const sourceAsset = createImageAsset({ name: '商品', url: 'product.png', width: 1200, height: 800 })
    const request = buildRelightRequest({ sourceAsset, resolution: '2k' })
    expect(request.capability).toBe(Capability.ImageEdit)
    expect(request.params).toEqual({
      sourceImageUrl: 'product.png',
      count: 2,
      resolution: '2k',
      size: { width: 2048, height: 1365 },
      sourceWidth: 1200,
      sourceHeight: 800,
      relight: RELIGHT_DEFAULT,
    })
  })

  it('保留补充说明和所选光效，数量不超过 4', () => {
    const sourceAsset = createImageAsset({ name: '商品', url: 'product.png', width: 800, height: 800 })
    const request = buildRelightRequest({
      sourceAsset,
      prompt: '  略提亮背景  ',
      count: 8,
      relight: { direction: 'left', quality: 'hard', temperature: 'cool' },
    })
    expect(request.params).toMatchObject({
      prompt: '略提亮背景',
      count: 4,
      relight: { direction: 'left', quality: 'hard', temperature: 'cool' },
    })
  })

  it('补充说明按模型上限截断，拼好的提示词不超过该上限', () => {
    const sourceAsset = createImageAsset({ name: '商品', url: 'product.png', width: 800, height: 800 })
    const relight = { direction: 'back' as const, quality: 'hard' as const, temperature: 'cool' as const }
    const request = buildRelightRequest({
      sourceAsset,
      prompt: '字'.repeat(PROMPT_MAX_LENGTH),
      promptMaxLength: PROMPT_MAX_LENGTH,
      relight,
    })
    const note = fitRelightNote('字'.repeat(PROMPT_MAX_LENGTH), PROMPT_MAX_LENGTH)
    expect(request.params).toMatchObject({ prompt: note, relight })
    expect(composeRelightPrompt(relight, note).length).toBeLessThanOrEqual(PROMPT_MAX_LENGTH)
  })
})
