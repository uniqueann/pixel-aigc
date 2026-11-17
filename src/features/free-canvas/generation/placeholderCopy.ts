import type { GenerationJob } from '@/editor/types'

/** 挂钟时长：60 秒以内只报秒，超过就报分秒。 */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`
}

/**
 * 生成占位框的第二行文案：排队/生成中带上已用时长（用户最想知道"还要不要等"），
 * 失败态给下一步操作。与右侧 `GenerationTaskStatus` 的阶段文案共用一套说法。
 */
export function placeholderDetail(
  status: GenerationJob['status'] | undefined,
  job: GenerationJob | undefined,
  now = Date.now(),
): string {
  if (status === 'failed' || status === 'cancelled') return '可在右侧重试或修改参数'
  if (status === 'processing') {
    return job ? `已用 ${formatElapsed(now - Date.parse(job.createdAt))} · 完成后替换此占位` : '结果完成后会替换此占位'
  }
  if (status === 'queued' || status === 'pending') {
    return job ? `已等待 ${formatElapsed(now - Date.parse(job.createdAt))}` : '正在等待生成任务'
  }
  return '正在等待生成任务'
}
