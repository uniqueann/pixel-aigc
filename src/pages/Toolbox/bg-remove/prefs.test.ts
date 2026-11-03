import { describe, expect, it } from 'vitest'
import { normalizeSettings, outputMime } from './prefs'
import { DEFAULT_BG_REMOVE_SETTINGS } from './types'

describe('抠图本机偏好', () => {
  it('默认透明，非法背景回退到默认值', () => {
    expect(DEFAULT_BG_REMOVE_SETTINGS.background).toBe('transparent')
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_BG_REMOVE_SETTINGS)
    expect(normalizeSettings({ background: 'transparent' })).toEqual({ background: 'transparent' })
    expect(normalizeSettings({ background: '#123456' })).toEqual({ background: '#123456' })
    expect(normalizeSettings({ background: 'not-a-color' })).toEqual(DEFAULT_BG_REMOVE_SETTINGS)
  })

  it('透明导出 PNG，纯色导出 JPEG', () => {
    expect(outputMime('transparent')).toBe('image/png')
    expect(outputMime('#ffffff')).toBe('image/jpeg')
  })
})
