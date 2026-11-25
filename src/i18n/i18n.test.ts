// @vitest-environment jsdom

import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { extractErrorExtra, extractRequestId, LEGACY_DB_TEXT_TO_KEY, translateApiError, translateLegacyDbText } from './apiErrors'
import { normalizeLocaleTag } from './detect'
import { activeLocale, formatDayMonthLabel, formatMegabytes, formatNumber } from './format'
import { i18n } from './index'
import { translateModelHint } from './modelLabels'
import { useLocaleStore } from './store'
import zhWorkstation from './locales/zh-CN/workstation.json'

const CJK_RE = /[\u4e00-\u9fff]/

afterEach(async () => {
  await useLocaleStore.getState().setLocale('zh-CN')
})

afterAll(async () => {
  await useLocaleStore.getState().setLocale('zh-CN')
})

describe('i18n locale core', () => {
  it('normalizes browser language tags to zh-CN or en-US', () => {
    expect(normalizeLocaleTag('zh')).toBe('zh-CN')
    expect(normalizeLocaleTag('zh-CN')).toBe('zh-CN')
    expect(normalizeLocaleTag('zh-TW')).toBe('zh-CN')
    expect(normalizeLocaleTag('zh-Hans-CN')).toBe('zh-CN')
    expect(normalizeLocaleTag('en')).toBe('en-US')
    expect(normalizeLocaleTag('en-US')).toBe('en-US')
    expect(normalizeLocaleTag('fr-FR')).toBe('en-US')
    expect(normalizeLocaleTag('')).toBeUndefined()
    expect(normalizeLocaleTag(undefined)).toBeUndefined()
  })

  it('switches locale, persists only locally, and updates document lang', async () => {
    await useLocaleStore.getState().setLocale('en-US')
    expect(useLocaleStore.getState().locale).toBe('en-US')
    expect(activeLocale()).toBe('en-US')
    expect(i18n.language).toBe('en-US')
    expect(localStorage.getItem('pixel:locale')).toBe('en-US')
    expect(document.documentElement.lang).toBe('en-US')

    await useLocaleStore.getState().setLocale('zh-CN')
    expect(useLocaleStore.getState().locale).toBe('zh-CN')
    expect(activeLocale()).toBe('zh-CN')
    expect(localStorage.getItem('pixel:locale')).toBe('zh-CN')
    expect(document.documentElement.lang).toBe('zh-CN')
  })

  it('formats numbers, dates, and megabytes according to active locale', async () => {
    expect(formatMegabytes(20 * 1024 * 1024)).toBe('20 MB')
    await useLocaleStore.getState().setLocale('en-US')
    expect(formatNumber(1234)).toBe('1,234')
    expect(formatDayMonthLabel(new Date(Date.UTC(2026, 9, 14, 12)), true)).toContain('October')
    expect(formatDayMonthLabel(new Date(Date.UTC(2025, 9, 14, 12)), false)).toContain('2025')
  })

  it('translates model hints in en-US', async () => {
    await useLocaleStore.getState().setLocale('en-US')
    const translated = translateModelHint(zhWorkstation.models.hints.supports4k)
    expect(translated).toBe('Supports 4K')
    expect(translated).not.toMatch(CJK_RE)
  })
})

describe('apiErrors translation', () => {
  it('preserves explicit server Chinese copy in zh-CN except platform 413', () => {
    expect(translateApiError({
      code: 'INVALID_SOURCE',
      message: '原图对象无效',
      status: 400,
    })).toBe('原图对象无效')

    expect(translateApiError({
      message: 'Request Entity Too Large',
      status: 413,
    })).toBe('图片太大，提交的内容超出了服务上限，请压缩图片后重试')
  })

  it('translates error codes, extra params, 413, and legacy DB strings in en-US without leaking CJK', async () => {
    await useLocaleStore.getState().setLocale('en-US')

    const insufficient = translateApiError({
      code: 'INSUFFICIENT_CREDITS',
      extra: { required: 12, balance: 3 },
      message: '积分不足',
      status: 402,
    })
    expect(insufficient).toContain('12')
    expect(insufficient).toContain('3')
    expect(insufficient).not.toMatch(CJK_RE)

    const unavailable = translateApiError({
      code: 'MODEL_UNAVAILABLE',
      message: '所选模型暂不可用',
      status: 503,
    })
    expect(unavailable).not.toMatch(CJK_RE)
    expect(unavailable.length).toBeGreaterThan(5)

    for (const legacyRaw of Object.keys(LEGACY_DB_TEXT_TO_KEY)) {
      const translated = translateLegacyDbText(legacyRaw)
      expect(translated).toBeTruthy()
      expect(translated).not.toMatch(CJK_RE)
    }

    const withRequestId = translateApiError({
      message: '未映射的后端中文报错',
      requestId: 'req-42',
    })
    expect(withRequestId).toContain('req-42')
    expect(withRequestId).not.toMatch(CJK_RE)

    const bundle = i18n.getResourceBundle('en-US', 'errors') as { codes?: Record<string, string> }
    const codes = Object.keys(bundle.codes ?? {})
    expect(codes.length).toBeGreaterThan(100)
    for (const code of codes) {
      const text = translateApiError({
        code,
        extra: code === 'INSUFFICIENT_CREDITS' ? { required: 10, balance: 2 } : undefined,
        message: '未翻译中文',
      })
      expect(text, `en-US translation missing for code ${code}`).toBeTruthy()
      expect(text, `en-US translation leaked CJK for code ${code}`).not.toMatch(CJK_RE)
    }

    expect(extractErrorExtra({ error: 'x', code: 'Y', requestId: 'r1', required: 5 })).toEqual({ required: 5 })
    expect(extractRequestId({ requestId: '  req-1 ' })).toBe('req-1')
  })
})
