import { i18n } from '@/i18n'

export type FooterMode = 'cancel' | 'download' | 'retry' | 'empty' | 'process'

/** 底部主行动只保留一个：处理中取消、全部完成下载、有失败先重试。 */
export function footerMode({ processing, itemCount, allDone, failedCount }: {
  processing: boolean
  itemCount: number
  allDone: boolean
  failedCount: number
}): FooterMode {
  if (processing) return 'cancel'
  if (allDone) return 'download'
  if (failedCount > 0) return 'retry'
  if (itemCount === 0) return 'empty'
  return 'process'
}

export function progressLabel({ itemCount, completedCount, failedCount, processing }: {
  itemCount: number
  completedCount: number
  failedCount: number
  processing: boolean
}) {
  if (itemCount === 0) return i18n.t('toolbox:shared.progressEmpty')
  // 处理中也要及时暴露失败数，避免失败项被“处理中”掩盖到批次结束。
  if (processing) {
    return failedCount > 0
      ? i18n.t('toolbox:shared.progressProcessingFailed', { completed: completedCount, total: itemCount, failed: failedCount })
      : i18n.t('toolbox:shared.progressProcessing', { completed: completedCount, total: itemCount })
  }
  if (failedCount > 0) {
    return i18n.t('toolbox:shared.progressProcessingFailed', { completed: completedCount, total: itemCount, failed: failedCount })
  }
  if (completedCount === itemCount) return i18n.t('toolbox:shared.progressAllDone', { total: itemCount })
  return i18n.t('toolbox:shared.progressProcessing', { completed: completedCount, total: itemCount })
}
