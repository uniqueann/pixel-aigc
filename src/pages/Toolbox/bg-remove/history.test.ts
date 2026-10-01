// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Capability } from '@/types'
import { deleteWorkstationHistory, listHistoryMetadata, recordWorkstationHistory } from '@/features/assets/workstationHistory'
import { clearOwnedImageSession } from '@/services/api/ownedImages'
import { persistBgRemoveQueue, persistBgRemoveResult, restoreBgRemoveItems, snapshotSucceeded } from './history'
import { readPrefs, readQueue, writePrefs, writeQueue } from './prefs'
import type { BatchImage } from './types'

const OWNER = '11111111-1111-4111-8111-111111111111'
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

function succeeded(id: string, extras: Partial<BatchImage> = {}): BatchImage {
  const matte = extras.matte ?? new Blob([png], { type: 'image/png' })
  return {
    id,
    file: new File(['source'], `${id}.jpg`, { type: 'image/jpeg' }),
    sourceMime: 'image/jpeg',
    sourceUrl: '',
    width: 3200,
    height: 5035,
    status: 'succeeded',
    matte,
    output: matte,
    outputMime: 'image/png',
    createdAt: '2026-10-02T00:00:00.000Z',
    ...extras,
  }
}

beforeEach(async () => {
  if (typeof URL.createObjectURL !== 'function') {
    URL.createObjectURL = () => 'blob:pixel-aigc-test'
    URL.revokeObjectURL = () => undefined
  }
  clearOwnedImageSession()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('pixel-aigc-history-v2')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('pixel-aigc-bg-remove-prefs')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
})

describe('智能抠图本地历史', () => {
  it('完成结果写入共享历史后，刷新可按队列快照恢复透明 PNG', async () => {
    const item = succeeded('cut-1', {
      transfer: { ownerId: OWNER, result: { objectKey: 'temporary/bg-remove-results/u/1.png', url: 'https://r2.test/1', mimeType: 'image/png', bytes: png.length } },
    })
    await persistBgRemoveResult({ ownerId: OWNER, prefsScope: OWNER, items: [item], selectedId: item.id, item })
    const listed = await listHistoryMetadata(OWNER)
    expect(listed).toEqual([expect.objectContaining({
      id: 'cut-1',
      toolSlug: 'bg-remove',
      capability: Capability.BgRemove,
      mimeType: 'image/png',
      objectKey: 'temporary/bg-remove-results/u/1.png',
      prompt: 'cut-1.jpg',
      width: 3200,
      height: 5035,
    })])

    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const restored = await restoreBgRemoveItems(OWNER, OWNER)
    vi.unstubAllGlobals()
    expect(fetch).not.toHaveBeenCalled()
    expect(restored.selectedId).toBe('cut-1')
    expect(restored.items).toHaveLength(1)
    expect(restored.items[0]).toMatchObject({
      id: 'cut-1',
      status: 'succeeded',
      restored: true,
      width: 3200,
      height: 5035,
    })
    expect(restored.items[0].matte?.type).toBe('image/png')
    expect(restored.items[0].file.name).toBe('cut-1.jpg')
  })

  it('清空队列后刷新不再回填历史结果', async () => {
    const item = succeeded('cut-2')
    await persistBgRemoveResult({ ownerId: OWNER, prefsScope: OWNER, items: [item], selectedId: item.id, item })
    await persistBgRemoveQueue(OWNER, [], null)
    const restored = await restoreBgRemoveItems(OWNER, OWNER)
    expect(restored.items).toEqual([])
    expect(await listHistoryMetadata(OWNER)).toHaveLength(1)
  })

  it('我的资产删除后不再恢复到抠图队列', async () => {
    const item = succeeded('cut-3')
    await persistBgRemoveResult({ ownerId: OWNER, prefsScope: OWNER, items: [item], selectedId: item.id, item })
    await deleteWorkstationHistory(OWNER, 'cut-3')
    expect((await restoreBgRemoveItems(OWNER, OWNER)).items).toEqual([])
  })

  it('没有队列快照时回退到共享历史里的抠图结果', async () => {
    await recordWorkstationHistory(OWNER, {
      id: 'legacy',
      toolSlug: 'bg-remove',
      capability: Capability.BgRemove,
      prompt: '旧结果.png',
      width: 10,
      height: 8,
      mimeType: 'image/png',
      result: new Blob([png], { type: 'image/png' }),
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    })
    const restored = await restoreBgRemoveItems(OWNER, OWNER)
    expect(restored.items.map(item => item.id)).toEqual(['legacy'])
    expect(restored.items[0].file.name).toBe('旧结果.png')
  })

  it('队列快照只包含已完成的透明底，待处理项不会写入', () => {
    expect(snapshotSucceeded([
      succeeded('done'),
      { ...succeeded('pending'), status: 'pending', matte: undefined, output: undefined },
    ]).map(item => item.id)).toEqual(['done'])
  })

  it('保存背景设置不会清掉队列快照', async () => {
    await writeQueue(OWNER, snapshotSucceeded([succeeded('keep')]), 'keep')
    await writePrefs(OWNER, { background: 'transparent' })
    expect(await readPrefs(OWNER)).toEqual({ background: 'transparent' })
    expect(await readQueue(OWNER)).toEqual({
      selectedId: 'keep',
      queue: [expect.objectContaining({ id: 'keep', name: 'keep.jpg' })],
    })
  })
})
