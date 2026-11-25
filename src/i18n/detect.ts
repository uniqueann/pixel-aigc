import { LOCALE_STORAGE_KEY, type Locale } from './types'

function isTestRuntime(): boolean {
  if (typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test') return true
  const maybeProcess = (globalThis as { process?: { env?: { VITEST?: string; NODE_ENV?: string } } }).process
  return Boolean(maybeProcess?.env?.VITEST || maybeProcess?.env?.NODE_ENV === 'test')
}

export function normalizeLocaleTag(tag: string | null | undefined): Locale | undefined {
  if (!tag) return undefined
  const trimmed = tag.trim()
  if (!trimmed) return undefined
  return /^zh\b/i.test(trimmed) ? 'zh-CN' : 'en-US'
}

export function detectBrowserLocale(): Locale {
  if (isTestRuntime()) return 'zh-CN'
  if (typeof navigator === 'undefined') return 'zh-CN'
  const candidates = Array.isArray(navigator.languages) && navigator.languages.length
    ? navigator.languages
    : navigator.language ? [navigator.language] : []
  for (const tag of candidates) {
    const normalized = normalizeLocaleTag(tag)
    if (normalized) return normalized
  }
  return 'zh-CN'
}

export function readStoredLocale(): Locale {
  if (isTestRuntime()) return 'zh-CN'
  if (typeof window === 'undefined') return 'zh-CN'
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (stored === 'zh-CN' || stored === 'en-US') return stored
  } catch {
    // 忽略存储受限异常
  }
  return detectBrowserLocale()
}

export function applyLocaleToDom(locale: Locale): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = locale
}
