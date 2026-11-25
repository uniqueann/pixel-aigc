import { metadataFromImageTask } from '@/features/assets/hydrateImageJobs'
import { isCurrentWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import { listHistoryDeletions, recordWorkstationHistory, recordVideoHistory } from '@/features/assets/workstationHistory'
import { metadataFromVideoTask } from '@/features/assets/hydrateVideoJobs'
import { i18n } from '@/i18n'
import { readOwnedImage } from '@/services/api/ownedImages'
import type { GenerationTask } from '@/types'

/** 与工作站共用稳定结果 ID，并尊重用户已删除的资产记录。 */
export async function saveCanvasTaskHistory(task: GenerationTask<unknown>, ownerId: string, signal?: AbortSignal) {
  if (task.resultVideos?.length) {
    if (signal?.aborted || !isCurrentWorkstationHistoryOwner(ownerId)) throw new Error(i18n.t('canvas:history.accountSwitched'))
    for (const record of metadataFromVideoTask(task)) await recordVideoHistory(ownerId, record)
    return
  }
  const deleted = await listHistoryDeletions(ownerId)
  const candidates = metadataFromImageTask(task).filter(item => !deleted.some(record => record.id === item.id || (item.objectKey && record.objectKey === item.objectKey)))
  const outcomes = await Promise.allSettled(candidates.map(async candidate => {
    const result = await readOwnedImage(candidate.image, { ownerId, signal })
    if (signal?.aborted || !isCurrentWorkstationHistoryOwner(ownerId)) throw new Error(i18n.t('canvas:history.accountSwitched'))
    const { image: _image, ...metadata } = candidate
    void _image
    await recordWorkstationHistory(ownerId, { ...metadata, result, mimeType: result.type })
  }))
  if (outcomes.some(item => item.status === 'rejected')) throw new Error(i18n.t('canvas:history.partialSaveFailed'))
}
