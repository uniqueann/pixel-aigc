import Papa from 'papaparse'
import type { PersonalizationPreferences } from '@shared/preferences'
import type { EmailAssistTaskParams } from '@/types'
import { buildEmailAssistRequest } from '../requestBuilder'
import {
  EMAIL_BATCH_HEADERS, EMAIL_BATCH_MAX_BYTES, EMAIL_BATCH_MAX_ROWS,
  EMAIL_LANGUAGES, EMAIL_OPERATIONS, EMAIL_POLISH_STYLES,
} from '../options'
import { formatEmailBatchError } from './labels'
import { EMAIL_BATCH_STATUS_LABELS, type EmailBatchOriginal, type EmailBatchRow } from './types'

type Defaults = PersonalizationPreferences['email']

export function formatEmailOperation(params: EmailAssistTaskParams) {
  const label = EMAIL_OPERATIONS.find(item => item.value === params.operation)?.label ?? params.operation
  if (params.operation !== 'polish') return label
  return `${label}：${(params.polishStyles?.length ? params.polishStyles : ['clear'])
    .map(value => EMAIL_POLISH_STYLES.find(item => item.value === value)?.label ?? value).join('+')}`
}

export function formatEmailLanguage(params: EmailAssistTaskParams) {
  return EMAIL_LANGUAGES.find(item => item.value === params.language)?.label ?? params.language
}

function parseParams(original: EmailBatchOriginal, defaults: Defaults): EmailAssistTaskParams {
  const sourceText = original['原始邮件内容'].trim()
  const instruction = original['编写指导'].trim()
  if (!sourceText) throw new Error('原始邮件内容不能为空')
  if (sourceText.length > 10000) throw new Error('原始邮件内容最多 10,000 字符')
  if (instruction.length > 1000) throw new Error('编写指导最多 1,000 字符')
  const setting = original['生成设置'].trim()
  const [operationLabel, ...styleParts] = setting.split(/[:：]/)
  const operation = setting ? EMAIL_OPERATIONS.find(item => item.label === operationLabel.trim())?.value : defaults.operation
  if (!operation) throw new Error('生成设置须为总结、回复、润色或检查语法')
  if (styleParts.length && operation !== 'polish') throw new Error('只有润色支持指定润色方式')
  let polishStyles = [...defaults.polishStyles]
  if (styleParts.length) {
    if (styleParts.length !== 1 || !styleParts[0].trim()) throw new Error('润色方式请填写为“润色：提升表达清晰度+缩短”')
    const styles = styleParts[0].split('+').map(label => EMAIL_POLISH_STYLES.find(item => item.label === label.trim())?.value)
    if (styles.some(value => !value)) throw new Error('润色方式支持提升表达清晰度、缩短、增长、简化，用 + 连接')
    polishStyles = [...new Set(styles.filter(value => value !== undefined))]
  }
  const languageValue = original['语言'].trim()
  const language = languageValue
    ? EMAIL_LANGUAGES.find(item => item.label === languageValue || item.value.toLowerCase() === languageValue.toLowerCase())?.value
    : defaults.language
  if (!language) throw new Error('语言须为支持的中文名称或语言代码')
  return buildEmailAssistRequest({ sourceText, instruction, operation, language, polishStyles }, 'csv-validation').params
}

export function parseEmailBatchCsv(text: string, defaults: Defaults): EmailBatchRow[] {
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), {
    delimiter: ',', dynamicTyping: false, skipEmptyLines: false,
  })
  if (parsed.errors.length) throw new Error('CSV 格式错误，请检查引号、逗号和换行后重新上传')
  const [rawHeaders, ...records] = parsed.data
  const headers = rawHeaders?.map(header => header.trim()) ?? []
  if (headers.some((header, index) => headers.indexOf(header) !== index)) throw new Error('CSV 列名不能重复')
  const missing = EMAIL_BATCH_HEADERS.filter(header => !headers.includes(header))
  if (missing.length) throw new Error(`CSV 缺少列：${missing.join('、')}`)
  const nonEmpty = records.map((cells, index) => ({ cells, recordNumber: index + 2 }))
    .filter(({ cells }) => cells.some(cell => cell.trim()))
  if (!nonEmpty.length) throw new Error('CSV 中没有邮件内容，请填写后重新上传')
  if (nonEmpty.length > EMAIL_BATCH_MAX_ROWS) throw new Error(`单批最多 ${EMAIL_BATCH_MAX_ROWS} 条邮件，请拆分 CSV 后上传`)
  return nonEmpty.map(({ cells, recordNumber }) => {
    const original = Object.fromEntries(EMAIL_BATCH_HEADERS.map(header => [header, cells[headers.indexOf(header)] ?? ''])) as EmailBatchOriginal
    const row: EmailBatchRow = { id: crypto.randomUUID(), recordNumber, original, status: 'pending' }
    try {
      if (cells.length !== headers.length) throw new Error('本行列数与表头不一致，请检查逗号和引号')
      return { ...row, params: parseParams(original, defaults) }
    } catch (error) {
      return { ...row, status: 'invalid', errorMessage: error instanceof Error ? error.message : '本行填写错误' }
    }
  })
}

export async function readEmailBatchFile(file: File, defaults: Defaults) {
  if (!file.name.toLowerCase().endsWith('.csv')) throw new Error('请上传 CSV 文件')
  if (file.size > EMAIL_BATCH_MAX_BYTES) throw new Error('CSV 文件不能超过 5 MB')
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()) }
  catch { throw new Error('文件读取失败或编码不支持，请另存为 CSV UTF-8 后上传') }
  return parseEmailBatchCsv(text, defaults)
}

function toCsv(fields: readonly string[], data: string[][]) {
  return '\uFEFF' + Papa.unparse({ fields: [...fields], data }, { newline: '\r\n', escapeFormulae: true })
}

export function createEmailBatchTemplate() {
  return toCsv(EMAIL_BATCH_HEADERS, []) + '\r\n'
}

export function exportEmailBatchCsv(rows: EmailBatchRow[]) {
  return toCsv([...EMAIL_BATCH_HEADERS, '生成结果', '状态', '错误信息', '模型', '实际扣减积分'], rows.map((row, index) => [
    ...EMAIL_BATCH_HEADERS.map(header => row.original[header]), row.resultText ?? '',
    EMAIL_BATCH_STATUS_LABELS[row.status],
    row.errorMessage ? formatEmailBatchError(index + 1, row.recordNumber, row.errorMessage) : '',
    row.modelProfileId ?? '', row.creditsCost == null ? '' : String(row.creditsCost),
  ]))
}

export function downloadEmailCsv(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = name
  document.body.appendChild(anchor); anchor.click(); anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
