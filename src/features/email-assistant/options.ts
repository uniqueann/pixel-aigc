import { EMAIL_LANGUAGES, EMAIL_LANGUAGE_OPTIONS, type EmailLanguage } from '@shared/email-models'
import { i18n } from '@/i18n'
import zhEmail from '@/i18n/locales/zh-CN/email.json'
import type { EmailAssistOperation, EmailPolishStyle } from '@/types'

export const EMAIL_OPERATION_IDS: readonly EmailAssistOperation[] = ['summarize', 'reply', 'polish', 'grammar']
export const EMAIL_POLISH_STYLE_IDS: readonly EmailPolishStyle[] = ['clear', 'shorten', 'lengthen', 'simplify']

const OPERATION_SET = new Set<string>(EMAIL_OPERATION_IDS)
const POLISH_STYLE_SET = new Set<string>(EMAIL_POLISH_STYLE_IDS)
const LANGUAGE_SET = new Set<string>(EMAIL_LANGUAGES.map(item => item.value))

export function emailOperationLabel(operation: string): string {
  if (!OPERATION_SET.has(operation)) return operation
  return i18n.t(`email:operations.${operation as EmailAssistOperation}`)
}

export function emailPolishStyleLabel(style: string): string {
  if (!POLISH_STYLE_SET.has(style)) return style
  return i18n.t(`email:polishStyles.${style as EmailPolishStyle}`)
}

export function emailLanguageLabel(language: string): string {
  if (!LANGUAGE_SET.has(language)) return language
  return i18n.t(`email:languages.${language as EmailLanguage}`)
}

export const EMAIL_OPERATIONS: { value: EmailAssistOperation; label: string }[] = EMAIL_OPERATION_IDS.map(value => ({
  value,
  label: zhEmail.operations[value],
}))

export const EMAIL_POLISH_STYLES: { value: EmailPolishStyle; label: string }[] = EMAIL_POLISH_STYLE_IDS.map(value => ({
  value,
  label: zhEmail.polishStyles[value],
}))

export { EMAIL_LANGUAGES, EMAIL_LANGUAGE_OPTIONS }

export const EMAIL_BATCH_HEADER_KEYS = {
  source: zhEmail.csv.headers.source,
  instruction: zhEmail.csv.headers.instruction,
  settings: zhEmail.csv.headers.settings,
  language: zhEmail.csv.headers.language,
} as const

export const EMAIL_BATCH_HEADERS = [
  EMAIL_BATCH_HEADER_KEYS.source,
  EMAIL_BATCH_HEADER_KEYS.instruction,
  EMAIL_BATCH_HEADER_KEYS.settings,
  EMAIL_BATCH_HEADER_KEYS.language,
] as const

export const EMAIL_BATCH_MAX_ROWS = 50
export const EMAIL_BATCH_MAX_BYTES = 5 * 1024 * 1024
