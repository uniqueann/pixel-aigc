import { i18n } from '@/i18n'
import { unavailableCropSummary } from '@/pages/Toolbox/aspect-ratio/subjectFocus'
import { itemStatus, type PipelineItem } from './types'

/** 检测不可用时优先展示降级说明，避免被「已完成」文案盖住。 */
export function pipelineQueueNote(item: PipelineItem, runState: 'idle' | 'running' | 'paused') {
  if (itemStatus(item) === 'failed') {
    return item.failedStep === 'watermark'
      ? i18n.t('toolbox:pipeline.queue.watermarkFailed')
      : i18n.t('toolbox:pipeline.queue.ratioFailed')
  }
  if (item.cropFocus?.unavailable) return item.cropFocus.note
  if (item.phase) return i18n.t(`toolbox:pipeline.phases.${item.phase}`)
  if (item.cropFocus?.source === 'grid' && item.cropFocus.note) return item.cropFocus.note
  if (itemStatus(item) === 'succeeded') {
    return item.watermarkStatus === 'skipped'
      ? i18n.t('toolbox:pipeline.queue.doneSkippedWatermark')
      : i18n.t('toolbox:pipeline.queue.doneAll')
  }
  if (item.intermediate) return i18n.t('toolbox:pipeline.queue.ratioDoneWaitingEncode')
  return runState === 'paused'
    ? i18n.t('toolbox:pipeline.queue.pausedWaiting')
    : i18n.t('toolbox:pipeline.queue.waitingRatio')
}

export function pipelineProgressLabel(items: PipelineItem[]) {
  const completed = items.filter(item => itemStatus(item) === 'succeeded')
  const failed = items.filter(item => itemStatus(item) === 'failed').length
  const degrade = unavailableCropSummary(completed.map(item => item.cropFocus))
  return i18n.t('toolbox:pipeline.progress', {
    completed: completed.length,
    total: items.length,
    failed: failed ? i18n.t('toolbox:pipeline.progressFailedSuffix', { count: failed }) : '',
    degrade: degrade ? ` · ${degrade}` : '',
  })
}
