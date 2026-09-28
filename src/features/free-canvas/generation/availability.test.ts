import { describe, expect, it } from 'vitest'
import { canSubmitFreeCanvasVariation, isFreeCanvasVariationEntryEnabled } from './availability'

describe('自由画布裂变开关', () => {
  it('非模拟模式关闭入口，也不允许提交', () => {
    const real = { mode: 'production', generationMode: 'real', cloud: false }
    expect(isFreeCanvasVariationEntryEnabled(real)).toBe(false)
    expect(canSubmitFreeCanvasVariation(real)).toBe(false)
  })

  it('模拟网关可以打开入口并提交', () => {
    const mock = { mode: 'production', generationMode: 'mock', cloud: false }
    expect(isFreeCanvasVariationEntryEnabled(mock)).toBe(true)
    expect(canSubmitFreeCanvasVariation(mock)).toBe(true)
  })

  it('云端开启时模拟标记也不能提交', () => {
    const cloud = { mode: 'production', generationMode: 'mock', cloud: true }
    expect(isFreeCanvasVariationEntryEnabled(cloud)).toBe(false)
    expect(canSubmitFreeCanvasVariation(cloud)).toBe(false)
  })

  it('测试环境仍允许控制器走现有裂变请求', () => {
    expect(canSubmitFreeCanvasVariation({ mode: 'test', generationMode: 'real', cloud: false })).toBe(true)
    expect(isFreeCanvasVariationEntryEnabled({ mode: 'test', generationMode: 'real', cloud: false })).toBe(false)
  })
})
