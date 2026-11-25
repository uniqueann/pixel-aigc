import { i18n } from '@/i18n'

/** 序号是导入后的非空记录顺序（从 1 起，错误行也占号）；csvLine 是文件行号（表头为第 1 行）。 */
export function formatEmailBatchLocator(sequence: number, csvLine: number) {
  return i18n.t('email:batch.locator', { sequence, csvLine })
}

export function formatEmailBatchError(sequence: number, csvLine: number, message: string) {
  return i18n.t('email:batch.errorWithLocator', {
    locator: formatEmailBatchLocator(sequence, csvLine),
    message,
  })
}
