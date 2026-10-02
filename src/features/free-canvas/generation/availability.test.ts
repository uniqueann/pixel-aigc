import { describe, expect, it } from 'vitest'
import { canSubmitFreeCanvasVariation, isFreeCanvasVariationEntryEnabled } from './availability'

describe('自由画布裂变开关', () => {
  it('未登录或配置未确认时关闭真实入口', () => {
    const real = { generationMode: 'real', cloud: false, authenticated: false, configured: false }
    expect(isFreeCanvasVariationEntryEnabled(real)).toBe(false)
    expect(canSubmitFreeCanvasVariation(real)).toBe(false)
  })

  it('模拟网关可以打开入口并提交', () => {
    const mock = { generationMode: 'mock', cloud: false }
    expect(isFreeCanvasVariationEntryEnabled(mock)).toBe(true)
    expect(canSubmitFreeCanvasVariation(mock)).toBe(true)
  })

  it('云端开启时模拟标记也不能提交', () => {
    const cloud = { generationMode: 'mock', cloud: true, authenticated: false, configured: false }
    expect(isFreeCanvasVariationEntryEnabled(cloud)).toBe(false)
    expect(canSubmitFreeCanvasVariation(cloud)).toBe(false)
  })

  it('已登录且后端裂变配置就绪时允许真实提交', () => {
    const ready = { generationMode: 'real', authenticated: true, configured: true }
    expect(canSubmitFreeCanvasVariation(ready)).toBe(true)
    expect(isFreeCanvasVariationEntryEnabled(ready)).toBe(true)
    expect(canSubmitFreeCanvasVariation({ ...ready, configured: false })).toBe(false)
    expect(canSubmitFreeCanvasVariation({ ...ready, authenticated: false })).toBe(false)
  })
})
