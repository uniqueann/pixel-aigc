import { describe, expect, it } from 'vitest'
import { imageCreditBlocksSubmit } from './imageCredits'

describe('图片积分不足拦截', () => {
  const ready = { status: 'ready' as const, credits: 6 }

  it('只在已知余额低于就绪报价时拦截', () => {
    expect(imageCreditBlocksSubmit({ quote: ready, balance: 5 })).toBe(true)
    expect(imageCreditBlocksSubmit({ quote: ready, balance: 6 })).toBe(false)
    expect(imageCreditBlocksSubmit({ quote: { status: 'ready', credits: 10, maximum: true }, balance: 9 })).toBe(true)
    expect(imageCreditBlocksSubmit({ quote: { status: 'ready', credits: 0 }, balance: 0 })).toBe(false)
  })

  it('余额未知、未登录、模拟或报价未就绪时不拦截', () => {
    expect(imageCreditBlocksSubmit({ quote: ready, balance: undefined })).toBe(false)
    expect(imageCreditBlocksSubmit({ mock: true, quote: ready, balance: 0 })).toBe(false)
    expect(imageCreditBlocksSubmit({ quote: { status: 'loading' }, balance: 0 })).toBe(false)
    expect(imageCreditBlocksSubmit({ quote: { status: 'unavailable' }, balance: 0 })).toBe(false)
    expect(imageCreditBlocksSubmit({ quote: { status: 'mock' }, balance: 0 })).toBe(false)
    expect(imageCreditBlocksSubmit({ balance: 0 })).toBe(false)
  })
})
