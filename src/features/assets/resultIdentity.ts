import type { GenerationTask } from '@/types'
export function historyIdForResult(taskId: string, image: { ordinal?: number }, index: number) {
  return image.ordinal === undefined ? `${taskId}:${index}` : `${taskId}:o${image.ordinal}`
}
export function imageTaskResults(task: GenerationTask<unknown>) {
  return task.resultImages?.length ? task.resultImages : (task.resultUrls ?? []).map(url => ({ url, width: 0, height: 0, mimeType: 'image/png', objectKey: undefined, ordinal: undefined, expiresAt: undefined }))
}
