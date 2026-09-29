import { Capability, type GenerationTask } from '@/types'
import { getTask, listTasks } from '@/services/api/task'
import { blobFromImageSource } from '@/features/image-workstation/download'
import { fusionHistoryText, readReferenceImageKey } from '@shared/fusion'
import { readRelight, relightHistoryText } from '@shared/relight'
import { readRetouchDirections, retouchHistoryText } from '@shared/retouch'
import { workstationSlugForCapability } from './labels'
import { listWorkstationHistory, recordWorkstationHistory } from './workstationHistory'

const IMAGE_JOB_CAPABILITIES = [Capability.ImageEdit, Capability.Variation] as const

function readPrompt(params: unknown) {
  if (!params || typeof params !== 'object' || !('prompt' in params)) return undefined
  const prompt = (params as { prompt?: unknown }).prompt
  return typeof prompt === 'string' && prompt.trim() ? prompt.trim() : undefined
}

export async function historyRecordsFromImageTask(task: GenerationTask<unknown>) {
  if (task.status !== 'succeeded') return []
  const directions = readRetouchDirections(task.params)
  const referenceKey = readReferenceImageKey(task.params)
  const relight = readRelight(task.params)
  const slug = referenceKey ? 'fusion' : relight ? 'relight' : directions.length ? 'retouch' : workstationSlugForCapability(task.capability)
  if (!slug) return []
  const note = readPrompt(task.params)
  const prompt = referenceKey
    ? fusionHistoryText(note)
    : relight
      ? relightHistoryText(relight, note)
      : directions.length
        ? retouchHistoryText(directions, note)
        : note
  const images = task.resultImages?.length
    ? task.resultImages
    : (task.resultUrls ?? []).map((url) => ({ url, width: 0, height: 0, mimeType: 'image/png', objectKey: undefined }))
  const records = []
  for (const [index, image] of images.entries()) {
    const result = await blobFromImageSource(image.url, image.objectKey)
    records.push({
      id: `${task.id}:${index}`,
      toolSlug: slug,
      capability: task.capability,
      prompt,
      width: image.width || 0,
      height: image.height || 0,
      mimeType: image.mimeType || result.type || 'image/jpeg',
      result,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    })
  }
  return records
}

/** 把已落库的智能编辑 / 裂变结果补进本地「我的资产」，避免只写 IndexedDB 时漏记。 */
export async function hydrateWorkstationHistoryFromImageJobs() {
  const existing = new Set((await listWorkstationHistory()).map((item) => item.id))
  for (const capability of IMAGE_JOB_CAPABILITIES) {
    const listed = await listTasks({ capability, page: 1 })
    for (const summary of listed.items) {
      if (summary.status !== 'succeeded') continue
      if (existing.has(`${summary.id}:0`)) continue
      const task = await getTask(summary.id)
      for (const record of await historyRecordsFromImageTask(task)) {
        if (existing.has(record.id)) continue
        await recordWorkstationHistory(record)
        existing.add(record.id)
      }
    }
  }
}
