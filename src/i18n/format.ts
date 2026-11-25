import { i18n } from './index'
import type { Locale } from './types'

export function activeLocale(locale?: Locale): Locale {
  if (locale) return locale
  return i18n.language === 'en-US' ? 'en-US' : 'zh-CN'
}

export function formatShortDateTime(value: string, locale?: Locale): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return i18n.t('common:time.unknown')
  const lng = activeLocale(locale)
  return date.toLocaleString(lng, {
    month: lng === 'en-US' ? 'short' : 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDateTime(value: string, locale?: Locale): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(activeLocale(locale))
}

export function formatDayMonthLabel(date: Date, sameYear: boolean, locale?: Locale): string {
  const lng = activeLocale(locale)
  return new Intl.DateTimeFormat(
    lng,
    sameYear
      ? { month: 'long', day: 'numeric' }
      : { year: 'numeric', month: 'long', day: 'numeric' },
  ).format(date)
}

export function formatNumber(value: number, locale?: Locale): string {
  return new Intl.NumberFormat(activeLocale(locale)).format(value)
}

export function formatMegabytes(bytes: number): string {
  const value = Math.round((bytes / (1024 * 1024)) * 10) / 10
  return i18n.t('common:units.mb', { value })
}
