import { Capability } from '@/types'
import { authEnabled } from '@/cloud/client'
import { resolveWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import {
  listHistoryDeletions,
  listHistoryMetadata,
  recordWorkstationHistory,
} from '@/features/assets/workstationHistory'
import { readOwnedImage } from '@/services/api/ownedImages'
import { MAX_FILES } from '../shared/inspect'
import { readQueue, writeQueue, type BgRemoveQueueSnapshot } from './prefs'
import type { BatchImage } from './types'

export const BG_REMOVE_HISTORY_SLUG = 'bg-remove'

export function bgRemoveHistoryOwner(userId: string | null) {
  try {
    return resolveWorkstationHistoryOwner(authEnabled, userId)
  } catch {
    return undefined
  }
}

export function snapshotSucceeded(items: BatchImage[]): BgRemoveQueueSnapshot[] {
  return items.flatMap(item => {
    if (item.status !== 'succeeded' || !item.matte) return []
    return [{
      id: item.id,
      name: item.file.name,
      width: item.width,
      height: item.height,
      objectKey: item.transfer?.result?.objectKey,
      createdAt: item.createdAt ?? new Date().toISOString(),
    }]
  })
}

export async function persistBgRemoveQueue(prefsScope: string, items: BatchImage[], selectedId: string | null) {
  await writeQueue(prefsScope, snapshotSucceeded(items), selectedId)
}

export async function recordBgRemoveHistory(ownerId: string, item: BatchImage) {
  if (!item.matte) return
  const createdAt = item.createdAt ?? new Date().toISOString()
  await recordWorkstationHistory(ownerId, {
    id: item.id,
    objectKey: item.transfer?.result?.objectKey,
    toolSlug: BG_REMOVE_HISTORY_SLUG,
    capability: Capability.BgRemove,
    prompt: item.file.name,
    width: item.width,
    height: item.height,
    mimeType: 'image/png',
    result: item.matte,
    createdAt,
    updatedAt: new Date().toISOString(),
  })
}

export async function persistBgRemoveResult(input: {
  ownerId?: string
  prefsScope: string
  items: BatchImage[]
  selectedId: string | null
  item: BatchImage
}) {
  await persistBgRemoveQueue(input.prefsScope, input.items, input.selectedId)
  if (!input.ownerId || input.item.restored || input.item.status !== 'succeeded' || !input.item.matte) return
  await recordBgRemoveHistory(input.ownerId, input.item)
}

function sourceMime(type: string): BatchImage['sourceMime'] {
  if (type === 'image/jpeg' || type === 'image/webp') return type
  return 'image/png'
}

function refsFromHistory(items: Awaited<ReturnType<typeof listHistoryMetadata>>): BgRemoveQueueSnapshot[] {
  return items.filter(item => item.toolSlug === BG_REMOVE_HISTORY_SLUG).slice(0, MAX_FILES).map(item => ({
    id: item.id,
    name: item.prompt?.trim() || '图片.png',
    width: item.width,
    height: item.height,
    objectKey: item.objectKey,
    createdAt: item.createdAt,
  }))
}

export async function restoreBgRemoveItems(prefsScope: string, ownerId?: string): Promise<{ items: BatchImage[]; selectedId: string | null }> {
  const stored = await readQueue(prefsScope)
  let refs = stored.queue
  if (refs === undefined && ownerId) refs = refsFromHistory(await listHistoryMetadata(ownerId))
  if (!refs?.length) return { items: [], selectedId: stored.selectedId }

  const deletions = ownerId ? await listHistoryDeletions(ownerId) : []
  const deletedIds = new Set(deletions.map(item => item.id))
  const deletedKeys = new Set(deletions.flatMap(item => item.objectKey ? [item.objectKey] : []))
  const items: BatchImage[] = []
  for (const ref of refs) {
    if (deletedIds.has(ref.id) || (ref.objectKey && deletedKeys.has(ref.objectKey))) continue
    if (!ownerId) continue
    try {
      const matte = await readOwnedImage({ historyId: ref.id, objectKey: ref.objectKey }, { ownerId })
      if (matte.type && matte.type !== 'image/png') continue
      const file = new File([matte], ref.name, { type: 'image/png', lastModified: Date.parse(ref.createdAt) || Date.now() })
      items.push({
        id: ref.id,
        file,
        sourceMime: sourceMime(file.type),
        sourceUrl: URL.createObjectURL(matte),
        width: ref.width,
        height: ref.height,
        status: 'succeeded',
        matte,
        restored: true,
        createdAt: ref.createdAt,
        transfer: ref.objectKey ? { ownerId, result: { objectKey: ref.objectKey, url: '', mimeType: 'image/png', bytes: matte.size } } : undefined,
      })
    } catch {
      /* 本地与对象都读不到时跳过这一张，其余结果仍可恢复。 */
    }
  }
  const selectedId = stored.selectedId && items.some(item => item.id === stored.selectedId)
    ? stored.selectedId
    : items[0]?.id ?? null
  return { items, selectedId }
}
