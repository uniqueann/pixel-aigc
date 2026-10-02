import { describe, expect, it } from 'vitest'
import { applyPreferencesPatch, defaultPreferences, preferencesPatchSchema, preferencesRequestSchema, resolveStartPage } from './preferences'

describe('个性化配置边界', () => {
  it('合并不同字段时保留其他默认值和工具记忆', () => {
    let value = applyPreferencesPatch(defaultPreferences(), { image: { lastUsed: { relight: { count: 4 } } }, email: { language: 'en' } })
    value = applyPreferencesPatch(value, { image: { lastUsed: { variation: { resolution: '4k' } } }, email: { operation: 'polish' } })
    expect(value.image.lastUsed).toEqual({ relight: { count: 4 }, variation: { resolution: '4k' } })
    expect(value.email).toEqual({ language: 'en', operation: 'polish', polishStyles: ['clear'] })
    expect(value.image.counts['smart-edit']).toBe(1)
  })
  it('清除后新增参数不会恢复其他旧记忆', () => {
    const initial = applyPreferencesPatch(defaultPreferences(), { image: { lastUsed: { relight: { count: 4 }, variation: { count: 3 } } } })
    const cleared = applyPreferencesPatch(initial, { image: { lastUsed: null } })
    expect(applyPreferencesPatch(cleared, { image: { lastUsed: { relight: { count: 2 } } } }).image.lastUsed).toEqual({ relight: { count: 2 } })
  })
  it.each([
    { image: { counts: { variation: 9 } } }, { image: { resolution: '8k' } },
    { workbench: { startPage: 'https://external.test' } }, { recent: { page: '/login' } },
    { image: { lastUsed: { watermark: { logo: 'secret-image' } } } },
    { image: { lastUsed: { 'smart-edit': { prompt: '不保存的提示词' } } } },
    { image: { lastUsed: { 'aspect-ratio': { fx: 0.5 } } } }, { userId: 'other' },
  ])('拒绝越界及非偏好字段：%j', patch => {
    expect(preferencesPatchSchema.safeParse(patch).success).toBe(false)
  })
  it('初始化也校验补丁，不接受任意数据', () => {
    expect(preferencesRequestSchema.safeParse({ patches: [{ email: { language: 'en' } }], initializeOnly: true }).success).toBe(true)
    expect(preferencesRequestSchema.safeParse({ patches: [{ email: { apiKey: 'secret' } }], initializeOnly: true }).success).toBe(false)
  })
  it('上次访问只恢复有效工作台页面', () => {
    const value = defaultPreferences(); value.workbench.startPage = 'last'; value.recent.page = '/toolbox/aspect-ratio'
    expect(resolveStartPage(value)).toBe('/toolbox/aspect-ratio')
    value.recent.page = '/unknown'
    expect(resolveStartPage(value)).toBe('/')
  })
})
