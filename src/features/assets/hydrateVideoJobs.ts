import { Capability, type GenerationTask } from '@/types'
import { listTasks } from '@/services/api/task'
import { isCurrentWorkstationHistoryOwner } from './historyOwner'
import { recordVideoHistory, type WorkstationHistoryMetadata } from './workstationHistory'

export function metadataFromVideoTask(task: GenerationTask<unknown>): WorkstationHistoryMetadata[] {
  if (task.status !== 'succeeded') return []
  return (task.resultVideos ?? []).map(({ url: _url, expiresAt: _expiresAt, ...video }) => {
    void _url; void _expiresAt
    return { id: `${task.id}:o${video.ordinal}`, taskId: task.id, ordinal: video.ordinal, objectKey: video.objectKey,
      mediaType: 'video', video, toolSlug: 'text-to-video', capability: Capability.TextToVideo,
      prompt: (task.params as { prompt?: string })?.prompt, width: video.width, height: video.height, mimeType: 'video/mp4',
      createdAt: task.createdAt, updatedAt: task.updatedAt }
  })
}

export async function hydrateVideoJobs(ownerId: string, signal?: AbortSignal) {
  for (let page = 1; page <= 1000; page++) {
    if (signal?.aborted || !isCurrentWorkstationHistoryOwner(ownerId)) throw new Error('视频资产读取已取消')
    const listed = await listTasks({ capability: Capability.TextToVideo, page })
    if (signal?.aborted || !isCurrentWorkstationHistoryOwner(ownerId)) throw new Error('视频资产读取已取消')
    for (const task of listed.items) {
      if (signal?.aborted || !isCurrentWorkstationHistoryOwner(ownerId)) throw new Error('视频资产读取已取消')
      if (!task.video || task.status !== 'succeeded') continue
      await recordVideoHistory(ownerId, { id: `${task.id}:o${task.video.ordinal}`, taskId: task.id, objectKey: task.video.objectKey,
        ordinal: task.video.ordinal, mediaType: 'video', video: task.video, toolSlug: 'text-to-video', capability: Capability.TextToVideo,
        prompt: task.preview, width: task.video.width, height: task.video.height, mimeType: 'video/mp4', createdAt: task.createdAt, updatedAt: task.updatedAt })
    }
    if (!listed.items.length || page * 20 >= listed.total) break
  }
}
