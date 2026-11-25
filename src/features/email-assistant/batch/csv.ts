import Papa from 'papaparse'
import type { PersonalizationPreferences } from '@shared/preferences'
import { EMAIL_LANGUAGES } from '@shared/email-models'
import { i18n } from '@/i18n'
import { translateApiError } from '@/i18n/apiErrors'
import { activeLocale, formatMegabytes } from '@/i18n/format'
import zhEmail from '@/i18n/locales/zh-CN/email.json'
import type { EmailAssistOperation, EmailAssistTaskParams, EmailPolishStyle } from '@/types'
import { buildEmailAssistRequest } from '../requestBuilder'
import {
  EMAIL_BATCH_HEADER_KEYS, EMAIL_BATCH_HEADERS, EMAIL_BATCH_MAX_BYTES, EMAIL_BATCH_MAX_ROWS,
  EMAIL_OPERATION_IDS, EMAIL_POLISH_STYLE_IDS,
  emailLanguageLabel, emailOperationLabel, emailPolishStyleLabel,
} from '../options'
import { formatEmailBatchError } from './labels'
import { emailBatchStatusLabel, type EmailBatchOriginal, type EmailBatchRow } from './types'

type Defaults = PersonalizationPreferences['email']
type HeaderSlot = 'source' | 'instruction' | 'settings' | 'language'

const HEADER_SLOTS: readonly HeaderSlot[] = ['source', 'instruction', 'settings', 'language']

const EN_HEADER_ALIASES: Record<HeaderSlot, readonly string[]> = {
  source: ['source email'],
  instruction: ['instructions', 'instruction'],
  settings: ['settings', 'generation settings'],
  language: ['language'],
}

const EN_OPERATION_ALIASES: Record<EmailAssistOperation, readonly string[]> = {
  summarize: ['summarize'],
  reply: ['reply'],
  polish: ['polish'],
  grammar: ['fix grammar', 'grammar check', 'check grammar'],
}

const EN_POLISH_STYLE_ALIASES: Record<EmailPolishStyle, readonly string[]> = {
  clear: ['clearer', 'improve clarity', 'clarity'],
  shorten: ['shorter', 'shorten'],
  lengthen: ['longer', 'lengthen'],
  simplify: ['simpler', 'simplify'],
}

const EN_LANGUAGE_ALIASES: Record<EmailAssistTaskParams['language'], readonly string[]> = {
  zh: ['chinese'],
  en: ['english'],
  'en-US': ['english (us)', 'us english', 'american english'],
  'en-GB': ['english (uk)', 'uk english', 'british english'],
  ja: ['japanese'],
  fr: ['french'],
  de: ['german'],
  es: ['spanish'],
  pt: ['portuguese'],
  it: ['italian'],
}

const HEADER_TO_SLOT = new Map<string, HeaderSlot>()
for (const slot of HEADER_SLOTS) {
  HEADER_TO_SLOT.set(zhEmail.csv.headers[slot].trim().toLowerCase(), slot)
  for (const alias of EN_HEADER_ALIASES[slot]) HEADER_TO_SLOT.set(alias, slot)
}

const OPERATION_LOOKUP = new Map<string, EmailAssistOperation>()
for (const op of EMAIL_OPERATION_IDS) {
  OPERATION_LOOKUP.set(op.toLowerCase(), op)
  OPERATION_LOOKUP.set(zhEmail.operations[op].trim().toLowerCase(), op)
  for (const alias of EN_OPERATION_ALIASES[op]) OPERATION_LOOKUP.set(alias, op)
}

const POLISH_STYLE_LOOKUP = new Map<string, EmailPolishStyle>()
for (const style of EMAIL_POLISH_STYLE_IDS) {
  POLISH_STYLE_LOOKUP.set(style.toLowerCase(), style)
  POLISH_STYLE_LOOKUP.set(zhEmail.polishStyles[style].trim().toLowerCase(), style)
  for (const alias of EN_POLISH_STYLE_ALIASES[style]) POLISH_STYLE_LOOKUP.set(alias, style)
}

const LANGUAGE_LOOKUP = new Map<string, EmailAssistTaskParams['language']>()
for (const item of EMAIL_LANGUAGES) {
  LANGUAGE_LOOKUP.set(item.value.toLowerCase(), item.value)
  LANGUAGE_LOOKUP.set(zhEmail.languages[item.value].trim().toLowerCase(), item.value)
  for (const alias of EN_LANGUAGE_ALIASES[item.value]) LANGUAGE_LOOKUP.set(alias, item.value)
}

export function formatEmailOperation(params: EmailAssistTaskParams) {
  const label = emailOperationLabel(params.operation)
  if (params.operation !== 'polish') return label
  const styles = (params.polishStyles?.length ? params.polishStyles : (['clear'] as const))
    .map(value => emailPolishStyleLabel(value))
    .join('+')
  return i18n.t('email:csv.operationWithStyles', { operation: label, styles })
}

export function formatEmailLanguage(params: EmailAssistTaskParams) {
  return emailLanguageLabel(params.language)
}

function parseParams(original: EmailBatchOriginal, defaults: Defaults): EmailAssistTaskParams {
  const sourceText = original[EMAIL_BATCH_HEADER_KEYS.source].trim()
  const instruction = original[EMAIL_BATCH_HEADER_KEYS.instruction].trim()
  if (!sourceText) throw new Error(i18n.t('email:csv.errors.sourceRequired'))
  if (sourceText.length > 10000) throw new Error(i18n.t('email:csv.errors.sourceTooLong'))
  if (instruction.length > 1000) throw new Error(i18n.t('email:csv.errors.instructionTooLong'))
  const setting = original[EMAIL_BATCH_HEADER_KEYS.settings].trim()
  const [operationLabel, ...styleParts] = setting.split(/[:：]/)
  const operation = setting ? OPERATION_LOOKUP.get(operationLabel.trim().toLowerCase()) : defaults.operation
  if (!operation) throw new Error(i18n.t('email:csv.errors.invalidOperation'))
  if (styleParts.length && operation !== 'polish') throw new Error(i18n.t('email:csv.errors.onlyPolishSupportsStyles'))
  let polishStyles = [...defaults.polishStyles]
  if (styleParts.length) {
    if (styleParts.length !== 1 || !styleParts[0].trim()) throw new Error(i18n.t('email:csv.errors.polishStyleFormat'))
    const styles = styleParts[0].split('+').map(label => POLISH_STYLE_LOOKUP.get(label.trim().toLowerCase()))
    if (styles.some(value => !value)) throw new Error(i18n.t('email:csv.errors.unsupportedPolishStyle'))
    polishStyles = [...new Set(styles.filter((value): value is EmailPolishStyle => value !== undefined))]
  }
  const languageValue = original[EMAIL_BATCH_HEADER_KEYS.language].trim()
  const language = languageValue
    ? LANGUAGE_LOOKUP.get(languageValue.toLowerCase())
    : defaults.language
  if (!language) throw new Error(i18n.t('email:csv.errors.invalidLanguage'))
  return buildEmailAssistRequest({ sourceText, instruction, operation, language, polishStyles }, 'csv-validation').params
}

export function parseEmailBatchCsv(text: string, defaults: Defaults): EmailBatchRow[] {
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), {
    delimiter: ',', dynamicTyping: false, skipEmptyLines: false,
  })
  if (parsed.errors.length) throw new Error(i18n.t('email:csv.errors.malformedCsv'))
  const [rawHeaders, ...records] = parsed.data
  const headers = rawHeaders?.map(header => header.trim()) ?? []
  const lowerHeaders = headers.map(header => header.toLowerCase())
  if (lowerHeaders.some((header, index) => lowerHeaders.indexOf(header) !== index)) {
    throw new Error(i18n.t('email:csv.errors.duplicateHeaders'))
  }
  const slotIndex = new Map<HeaderSlot, number>()
  for (const [index, lower] of lowerHeaders.entries()) {
    const slot = HEADER_TO_SLOT.get(lower)
    if (!slot) continue
    if (slotIndex.has(slot)) throw new Error(i18n.t('email:csv.errors.duplicateHeaders'))
    slotIndex.set(slot, index)
  }
  const missing = HEADER_SLOTS.filter(slot => !slotIndex.has(slot))
  if (missing.length) {
    const columns = missing
      .map(slot => i18n.t(`email:csv.headers.${slot}`))
      .join(i18n.t('email:csv.listSeparator'))
    throw new Error(i18n.t('email:csv.errors.missingColumns', { columns }))
  }
  const nonEmpty = records.map((cells, index) => ({ cells, recordNumber: index + 2 }))
    .filter(({ cells }) => cells.some(cell => cell.trim()))
  if (!nonEmpty.length) throw new Error(i18n.t('email:csv.errors.emptyRecords'))
  if (nonEmpty.length > EMAIL_BATCH_MAX_ROWS) {
    throw new Error(i18n.t('email:csv.errors.tooManyRows', { max: EMAIL_BATCH_MAX_ROWS }))
  }
  return nonEmpty.map(({ cells, recordNumber }) => {
    const original: EmailBatchOriginal = {
      [EMAIL_BATCH_HEADER_KEYS.source]: cells[slotIndex.get('source')!] ?? '',
      [EMAIL_BATCH_HEADER_KEYS.instruction]: cells[slotIndex.get('instruction')!] ?? '',
      [EMAIL_BATCH_HEADER_KEYS.settings]: cells[slotIndex.get('settings')!] ?? '',
      [EMAIL_BATCH_HEADER_KEYS.language]: cells[slotIndex.get('language')!] ?? '',
    }
    const row: EmailBatchRow = { id: crypto.randomUUID(), recordNumber, original, status: 'pending' }
    try {
      if (cells.length !== headers.length) throw new Error(i18n.t('email:csv.errors.columnCountMismatch'))
      return { ...row, params: parseParams(original, defaults) }
    } catch (error) {
      return { ...row, status: 'invalid', errorMessage: error instanceof Error ? error.message : i18n.t('email:csv.errors.rowInvalidFallback') }
    }
  })
}

export async function readEmailBatchFile(file: File, defaults: Defaults) {
  if (!file.name.toLowerCase().endsWith('.csv')) throw new Error(i18n.t('email:csv.errors.invalidFileType'))
  if (file.size > EMAIL_BATCH_MAX_BYTES) {
    throw new Error(i18n.t('email:csv.errors.fileTooLarge', { limit: formatMegabytes(EMAIL_BATCH_MAX_BYTES) }))
  }
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()) }
  catch { throw new Error(i18n.t('email:csv.errors.encodingUnsupported')) }
  return parseEmailBatchCsv(text, defaults)
}

function toCsv(fields: readonly string[], data: string[][]) {
  return '\uFEFF' + Papa.unparse({ fields: [...fields], data }, { newline: '\r\n', escapeFormulae: true })
}

function localizedCsvHeaders(): [string, string, string, string] {
  const lng = activeLocale()
  return [
    i18n.t('email:csv.headers.source', { lng }),
    i18n.t('email:csv.headers.instruction', { lng }),
    i18n.t('email:csv.headers.settings', { lng }),
    i18n.t('email:csv.headers.language', { lng }),
  ]
}

function localizedRowError(row: EmailBatchRow, sequence: number): string {
  if (!row.errorMessage && !row.errorCode) return ''
  const detail = row.errorCode
    ? translateApiError({
        code: row.errorCode,
        message: row.errorMessage,
        fallback: i18n.t('email:runner.errors.generateFailed'),
      })
    : row.errorMessage!
  return formatEmailBatchError(sequence, row.recordNumber, detail)
}

export function createEmailBatchTemplate() {
  return toCsv(localizedCsvHeaders(), []) + '\r\n'
}

export function exportEmailBatchCsv(rows: EmailBatchRow[]) {
  const lng = activeLocale()
  return toCsv([
    ...localizedCsvHeaders(),
    i18n.t('email:csv.exportHeaders.result', { lng }),
    i18n.t('email:csv.exportHeaders.status', { lng }),
    i18n.t('email:csv.exportHeaders.error', { lng }),
    i18n.t('email:csv.exportHeaders.model', { lng }),
    i18n.t('email:csv.exportHeaders.credits', { lng }),
  ], rows.map((row, index) => [
    ...EMAIL_BATCH_HEADERS.map(header => row.original[header] ?? ''),
    row.resultText ?? '',
    emailBatchStatusLabel(row.status),
    localizedRowError(row, index + 1),
    row.modelProfileId ?? '',
    row.creditsCost == null ? '' : String(row.creditsCost),
  ]))
}

export function downloadEmailCsv(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = name
  document.body.appendChild(anchor); anchor.click(); anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
