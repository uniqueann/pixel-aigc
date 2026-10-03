import { describe, expect, it } from 'vitest'
import { SEEDANCE_VIDEO_MODEL, type VideoModelProfile } from '@shared/video-models'
import { videoCreditBlocksSubmit, videoCreditEstimateText, videoCreditShortfallText, videoCreditsForDuration } from './videoCredits'

const custom: Pick<VideoModelProfile, 'pricing'> = {
  pricing: { version: 'custom', creditsPerVideo: { 5: 7, 10: 11 } },
}

describe('视频积分报价', () => {
  it('从模型价格读取 5 秒和 10 秒，不把缺价写成 0 或另一档时长', () => {
    expect(videoCreditsForDuration(SEEDANCE_VIDEO_MODEL, 5)).toBe(50)
    expect(videoCreditsForDuration(SEEDANCE_VIDEO_MODEL, 10)).toBe(100)
    expect(videoCreditsForDuration(custom, 5)).toBe(7)
    expect(videoCreditsForDuration(custom, 10)).toBe(11)
    expect(videoCreditsForDuration(undefined, 5)).toBeUndefined()
    expect(videoCreditsForDuration(custom, 7)).toBeUndefined()
    expect(videoCreditsForDuration({ pricing: { version: 'partial', creditsPerVideo: { 5: 7 } as VideoModelProfile['pricing']['creditsPerVideo'] } }, 10)).toBeUndefined()
    expect(videoCreditsForDuration({ pricing: { version: 'bad', creditsPerVideo: { 5: Number.NaN, 10: -1 } } }, 5)).toBeUndefined()
    expect(videoCreditsForDuration({ pricing: { version: 'bad', creditsPerVideo: { 5: Number.NaN, 10: -1 } } }, 10)).toBeUndefined()
  })

  it('缺价、余额不足和模拟模式使用固定文案，声音不参与计算', () => {
    expect(videoCreditEstimateText(50, false)).toBe('预计消耗 50 积分')
    expect(videoCreditEstimateText(undefined, false)).toBe('积分预估暂不可用')
    expect(videoCreditEstimateText(Number.NaN, false)).toBe('积分预估暂不可用')
    expect(videoCreditEstimateText(50, true)).toBe('模拟生成，不消耗积分')
    expect(videoCreditShortfallText(100, 68, false)).toBe('积分不足，需要 100 积分，当前 68')
    expect(videoCreditShortfallText(50, 68, false)).toBeNull()
    expect(videoCreditShortfallText(50, 50, false)).toBeNull()
    expect(videoCreditShortfallText(undefined, 0, false)).toBeNull()
    expect(videoCreditShortfallText(100, 0, true)).toBeNull()
    expect(videoCreditBlocksSubmit({ mockGateway: false, loading: false, credits: 100, balance: 68 })).toBe(true)
    expect(videoCreditBlocksSubmit({ mockGateway: false, loading: false, credits: 50, balance: 68 })).toBe(false)
    expect(videoCreditBlocksSubmit({ mockGateway: false, loading: false, credits: undefined, balance: 68 })).toBe(true)
    expect(videoCreditBlocksSubmit({ mockGateway: true, loading: false, credits: undefined, balance: 0 })).toBe(false)
    expect(videoCreditBlocksSubmit({ mockGateway: false, loading: true, credits: undefined, balance: 0 })).toBe(false)
  })
})
