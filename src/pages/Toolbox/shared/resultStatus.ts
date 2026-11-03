export type ResultStatus = 'pending' | 'processing' | 'succeeded' | 'failed'

/** 结果网格与徽标共用的状态文案。 */
export function resultStatusLabel(status: ResultStatus) {
  if (status === 'succeeded') return '完成'
  if (status === 'processing') return '处理中'
  if (status === 'failed') return '失败'
  return '等待'
}
