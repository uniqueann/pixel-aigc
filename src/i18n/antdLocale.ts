import type { Locale as AntdLocale } from 'antd/es/locale'
import zhCN from 'antd/locale/zh_CN'
import type { Locale } from './types'

let cachedEnUsAntdLocale: AntdLocale | undefined

export async function loadAntdEnUS(): Promise<AntdLocale> {
  if (!cachedEnUsAntdLocale) {
    const mod = await import('antd/locale/en_US')
    cachedEnUsAntdLocale = mod.default
  }
  return cachedEnUsAntdLocale
}

export function getAntdLocale(locale: Locale): AntdLocale {
  return locale === 'en-US' ? (cachedEnUsAntdLocale ?? zhCN) : zhCN
}

export function fontFamilyForLocale(locale: Locale): string {
  return locale === 'en-US'
    ? "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    : "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', Roboto, sans-serif"
}
