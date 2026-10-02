import { normalizeImageBlob } from '@shared/image-format'
import { Capability, type GenerationTask } from '@/types'
import { getTask, listTasks } from '@/services/api/task'
import { readOwnedImage } from '@/services/api/ownedImages'
import { blobFromImageSource } from '@/features/image-workstation/download'
import { fusionHistoryText, readReferenceImageKey } from '@shared/fusion'
import { readRelight, relightHistoryText } from '@shared/relight'
import { readRetouchDirections, retouchHistoryText } from '@shared/retouch'
import { workstationSlugForCapability } from './labels'
import { associateHistoryResult, compareHistory, HISTORY_LIMIT, listHistoryMetadata, listHistoryDeletions, recordWorkstationHistory, type WorkstationHistoryMetadata } from './workstationHistory'
import { isCurrentWorkstationHistoryOwner, currentWorkstationHistoryOwner } from './historyOwner'
import { historyIdForResult, imageTaskResults } from './resultIdentity'

const CAPABILITIES = [Capability.ImageEdit, Capability.Variation, Capability.TextToImage] as const
export function metadataFromImageTask(task: GenerationTask<unknown>) {
  if (task.status !== 'succeeded') return []
  const directions = readRetouchDirections(task.params)
  const referenceKey = readReferenceImageKey(task.params)
  const relight = readRelight(task.params)
  const slug = referenceKey ? 'fusion' : relight ? 'relight' : directions.length ? 'retouch' : workstationSlugForCapability(task.capability)
  if (!slug) return []
  const raw = (task.params as { prompt?: unknown })?.prompt
  const note = typeof raw === 'string' && raw.trim() ? raw.trim() : undefined
  const prompt = referenceKey ? fusionHistoryText(note) : relight ? relightHistoryText(relight, note) : directions.length ? retouchHistoryText(directions, note) : note
  return imageTaskResults(task).map((image, index) => ({
    id: historyIdForResult(task.id, image, index), objectKey: image.objectKey, ordinal: image.ordinal, taskId: task.id,
    toolSlug: slug, capability: task.capability, prompt, width: image.width, height: image.height, mimeType: image.mimeType,
    createdAt: task.createdAt, updatedAt: task.updatedAt, image,
  }))
}
async function readCandidate(candidate: ReturnType<typeof metadataFromImageTask>[number], ownerId: string, signal?: AbortSignal) {
  const blob = candidate.objectKey
    ? await readOwnedImage(candidate.image, { ownerId, signal })
    : await blobFromImageSource(candidate.image.url)
  const { image: _image, ...fields } = candidate
  void _image
  const result = await normalizeImageBlob(blob)
  return { ...fields, result, mimeType: result.type }
}
export async function historyRecordsFromImageTask(task: GenerationTask<unknown>, ownerId = currentWorkstationHistoryOwner()) {
  const outcomes = await Promise.allSettled(metadataFromImageTask(task).map(candidate => readCandidate(candidate, ownerId)))
  return outcomes.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
}

/** 先按元数据选定最近 50 张，再读取缺失图片；失败候选不会触发更旧图片下载。 */
export async function hydrateWorkstationHistoryFromImageJobs(ownerId: string, options: { signal?: AbortSignal; onProgress?: () => void } = {}) {
  const assertOwner = () => {
    if (options.signal?.aborted) throw new DOMException('补记已取消', 'AbortError')
    if (!isCurrentWorkstationHistoryOwner(ownerId)) throw new Error('账号已切换，停止补记历史')
  }
  assertOwner()
  const [local, deletions] = await Promise.all([listHistoryMetadata(ownerId), listHistoryDeletions(ownerId)])
  const existingKeys = new Set(local.flatMap(item => item.objectKey ? [item.objectKey] : []))
  const existingIds = new Set(local.map(item => item.id))
  const deletedIds = new Set(deletions.map(item => item.id))
  const deletedKeys = new Set(deletions.flatMap(item => item.objectKey ? [item.objectKey] : []))
  // 无法确认数组位置的旧任务不重建，防止把原有图片关联到另一个序号。
  const legacyTasks = new Set(deletions.filter(item => !item.objectKey).map(item => item.taskId ?? item.id.replace(/:(?:o)?\d+$/, '')))
  const legacyLocal = new Map<string, WorkstationHistoryMetadata[]>()
  for (const item of local.filter(item => !item.objectKey)) {
    const taskId = item.taskId ?? item.id.replace(/:(?:o)?\d+$/, '')
    legacyLocal.set(taskId, [...(legacyLocal.get(taskId) ?? []), item])
  }
  const pool = new Map<string, WorkstationHistoryMetadata | ReturnType<typeof metadataFromImageTask>[number]>()
  for (const item of local) pool.set(item.objectKey ?? item.id, item)
  const seen = new Set<string>()
  const finished = new Set<Capability>()
  const detailErrors: unknown[] = []
  for (let page = 1; finished.size < CAPABILITIES.length; page++) {
    assertOwner()
    const pages = await Promise.all(CAPABILITIES.filter(capability => !finished.has(capability)).map(async capability => ({ capability, listed: await listTasks({ capability, page }) })))
    assertOwner()
    const summaries = new Map<string, (typeof pages)[number]['listed']['items'][number]>()
    for (const { capability, listed } of pages) {
      if (!listed.items.length || page * 20 >= listed.total) finished.add(capability)
      for (const summary of listed.items) {
        if (summary.status !== 'succeeded' || seen.has(summary.id) || legacyTasks.has(summary.id)) continue
        const old = legacyLocal.get(summary.id)
        if (old?.some(item => !item.updatedAt || item.updatedAt !== summary.updatedAt)) continue
        seen.add(summary.id); summaries.set(summary.id, summary)
      }
    }
    const tasks = [...summaries.values()]
    for (let offset = 0; offset < tasks.length; offset += 4) {
      const outcomes = await Promise.allSettled(tasks.slice(offset, offset + 4).map(summary => getTask(summary.id)))
      assertOwner()
      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') { detailErrors.push(outcome.reason); continue }
        const task = outcome.value
        const old = legacyLocal.get(task.id)
        if (old?.some(item => item.updatedAt !== task.updatedAt)) continue
        const candidates = metadataFromImageTask(task)
        let uncertain = false
        for (const item of old ?? []) {
          const match = item.id.match(/:(\d+)$/)
          const candidate = match ? candidates[Number(match[1])] : undefined
          if (!candidate?.objectKey) { uncertain = true; break }
          assertOwner()
          await associateHistoryResult(ownerId, item.id, { taskId: task.id, ordinal: candidate.ordinal, objectKey: candidate.objectKey, updatedAt: task.updatedAt })
          existingKeys.add(candidate.objectKey)
          pool.delete(item.id)
          pool.set(candidate.objectKey, { ...item, objectKey: candidate.objectKey, ordinal: candidate.ordinal, taskId: task.id })
        }
        if (uncertain) continue
        for (const candidate of candidates) {
          if (deletedIds.has(candidate.id) || (candidate.objectKey && deletedKeys.has(candidate.objectKey))) continue
          const identity = candidate.objectKey ?? candidate.id
          if (!pool.has(identity)) pool.set(identity, candidate)
        }
      }
    }
    const selected = [...pool.values()].sort(compareHistory).slice(0, HISTORY_LIMIT)
    const cutoff = selected.length === HISTORY_LIMIT ? selected[selected.length - 1].createdAt : undefined
    // 时间相等时仍继续翻页，确保稳定 ID 的排序边界没有漏项。
    if (cutoff && pages.every(({ listed }) => !listed.items.length || listed.items[listed.items.length - 1].createdAt < cutoff)) break
  }
  assertOwner()
  const missing = [...pool.values()].sort(compareHistory).slice(0, HISTORY_LIMIT).filter((item): item is ReturnType<typeof metadataFromImageTask>[number] => 'image' in item && !existingIds.has(item.id) && !(item.objectKey && existingKeys.has(item.objectKey)))
  const failures: unknown[] = [...detailErrors]
  await Promise.all(missing.map(async candidate => {
    try {
      assertOwner()
      const record = await readCandidate(candidate, ownerId, options.signal)
      assertOwner()
      await recordWorkstationHistory(ownerId, record)
      options.onProgress?.()
    } catch (error) { failures.push(error) }
  }))
  assertOwner()
  return { failed: failures.length }
}
