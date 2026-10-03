import { unavailableCropSummary } from '@/pages/Toolbox/aspect-ratio/subjectFocus'
import { itemStatus, type PipelineItem } from './types'

const phaseLabels = {
  detect: '正在识别主体',
  ratio: '正在转比例',
  watermark: '正在加水印',
  encode: '正在生成成品',
} as const

/** 检测不可用时优先展示降级说明，避免被「已完成」文案盖住。 */
export function pipelineQueueNote(item: PipelineItem, runState: 'idle' | 'running' | 'paused') {
  if (item.cropFocus?.unavailable && itemStatus(item) !== 'failed') return item.cropFocus.note
  if (item.phase) return phaseLabels[item.phase]
  if (item.cropFocus?.source === 'grid' && item.cropFocus.note) return item.cropFocus.note
  if (itemStatus(item) === 'succeeded') return item.watermarkStatus === 'skipped' ? '转比例完成 · 已跳过水印' : '转比例完成 · 水印完成'
  if (item.intermediate) return '转比例完成 · 等待生成成品'
  return runState === 'paused' ? '已暂停 · 等待继续处理' : '等待转比例'
}

export function pipelineProgressLabel(items: PipelineItem[]) {
  const completed = items.filter(item => itemStatus(item) === 'succeeded')
  const failed = items.filter(item => itemStatus(item) === 'failed').length
  const degrade = unavailableCropSummary(completed.map(item => item.cropFocus))
  return `${completed.length} / ${items.length} 张已完成${failed ? ` · ${failed} 张失败` : ''}${degrade ? ` · ${degrade}` : ''}`
}
