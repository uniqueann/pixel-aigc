// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Capability } from '@/types'
import { resolveWorkstationHistoryOwner } from './historyOwner'
import {
  openHistoryDatabase,
  listHistoryMetadata,
  listHistoryPreviews,
  listHistoryDeletions,
  readHistoryImage,
  clearWorkstationHistory,
  deleteWorkstationHistory,
  listWorkstationHistory,
  recordWorkstationHistory,
  recordVideoHistory,
} from './workstationHistory'

function record(id: string, createdAt: string) {
  return {
    id,
    toolSlug: 'repaint' as const,
    capability: Capability.Inpaint,
    prompt: '一盆小型绿色盆栽',
    width: 1280,
    height: 1280,
    mimeType: 'image/jpeg',
    result: new Blob([id], { type: 'image/jpeg' }),
    createdAt,
    updatedAt: createdAt,
  }
}

const OWNER_A = '11111111-1111-4111-8111-111111111111'
const OWNER_B = '22222222-2222-4222-8222-222222222222'

describe('工作站本地历史', () => {
  beforeEach(async () => {
    await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase('pixel-aigc-history-v2'); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error) })
    await clearWorkstationHistory(OWNER_A)
    await clearWorkstationHistory(OWNER_B)
  })

  it('写入成功结果后可按时间倒序读出', async () => {
    await recordWorkstationHistory(OWNER_A, record('older', '2026-09-27T12:00:00.000Z'))
    await recordWorkstationHistory(OWNER_A, record('newer', '2026-09-27T13:00:00.000Z'))
    const items = await listWorkstationHistory(OWNER_A)
    expect(items.map((item) => item.id)).toEqual(['newer', 'older'])
    expect(items[0].result.size).toBe('newer'.length)
    expect(items[0].mimeType).toBe('image/jpeg')
  })

  it('读取旧库中标成 PNG 的 JPEG，并在新写入时纠正格式', async () => {
    const bytes = new Uint8Array([255, 216, 255, 224, 0, 16])
    const legacy = { ...record('legacy-jpeg', '2026-09-27T12:00:00.000Z'), mimeType: 'image/png' }
    await recordWorkstationHistory(OWNER_A, { ...legacy, result: new Blob([bytes], { type: 'image/png' }) })
    expect((await listWorkstationHistory(OWNER_A))[0].mimeType).toBe('image/jpeg')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('pixel-aigc-history-v2', 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const { result: _result, ...fields } = legacy
    void _result
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('workstationResults', 'readwrite')
      tx.objectStore('workstationResults').put({ ...fields, ownerId: OWNER_A, resultBytes: bytes.buffer })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
    const restored = (await listWorkstationHistory(OWNER_A))[0]
    expect(restored.id).toBe('legacy-jpeg')
    expect(restored.mimeType).toBe('image/jpeg')
    expect(restored.result.type).toBe('image/jpeg')
    expect(restored.result.size).toBe(bytes.length)
  })

  it('可删除单条记录', async () => {
    await recordWorkstationHistory(OWNER_A, record('keep', '2026-09-27T12:00:00.000Z'))
    await recordWorkstationHistory(OWNER_A, record('drop', '2026-09-27T13:00:00.000Z'))
    await deleteWorkstationHistory(OWNER_A, 'drop')
    expect((await listWorkstationHistory(OWNER_A)).map((item) => item.id)).toEqual(['keep'])
  })

  it('相同任务 ID 按账号分开，删除及清空只影响当前账号', async () => {
    await recordWorkstationHistory(OWNER_A, record('same', '2026-09-27T12:00:00.000Z'))
    await recordWorkstationHistory(OWNER_B, record('same', '2026-09-27T13:00:00.000Z'))
    expect((await listWorkstationHistory(OWNER_A))[0].createdAt).toContain('12:00')
    expect((await listWorkstationHistory(OWNER_B))[0].createdAt).toContain('13:00')
    await deleteWorkstationHistory(OWNER_A, 'same')
    expect(await listWorkstationHistory(OWNER_A)).toEqual([])
    expect((await listWorkstationHistory(OWNER_B)).map(item => item.id)).toEqual(['same'])
    await recordWorkstationHistory(OWNER_A, record('only-a', '2026-09-27T14:00:00.000Z'))
    await clearWorkstationHistory(OWNER_A)
    expect(await listWorkstationHistory(OWNER_A)).toEqual([])
    expect((await listWorkstationHistory(OWNER_B)).map(item => item.id)).toEqual(['same'])
  })

  it('每个账号独立保留最近 50 条', async () => {
    await recordWorkstationHistory(OWNER_B, record('only-b', '2026-09-27T12:00:00.000Z'))
    for (let index = 0; index < 52; index += 1) {
      await recordWorkstationHistory(OWNER_A, record(`a-${index}`, new Date(Date.UTC(2026, 8, 27, 12, index)).toISOString()))
    }
    const items = await listWorkstationHistory(OWNER_A)
    expect(items).toHaveLength(50)
    expect(items.some(item => item.id === 'a-0' || item.id === 'a-1')).toBe(false)
    expect((await listWorkstationHistory(OWNER_B)).map(item => item.id)).toEqual(['only-b'])
  })

  it('旧库数据不进入带账号的新库', async () => {
    const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('pixel-aigc-history', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('workstationResults', { keyPath: 'id' })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = legacy.transaction('workstationResults', 'readwrite')
      tx.objectStore('workstationResults').put({ id: 'legacy', createdAt: '2026-09-27T12:00:00.000Z' })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    legacy.close()
    expect(await listWorkstationHistory(OWNER_A)).toEqual([])
  })

  it('登录模式缺少有效用户时拒绝读取，游客只进入匿名分区', async () => {
    expect(() => resolveWorkstationHistoryOwner(true, null)).toThrow('登录账号尚未就绪')
    expect(() => resolveWorkstationHistoryOwner(true, 'local')).toThrow('登录账号尚未就绪')
    expect(resolveWorkstationHistoryOwner(false, null)).toBe('anonymous')
    await expect(listWorkstationHistory('')).rejects.toThrow('缺少历史记录所属账号')
    await recordWorkstationHistory('anonymous', record('guest', '2026-09-27T12:00:00.000Z'))
    expect((await listWorkstationHistory(OWNER_A))).toEqual([])
    await clearWorkstationHistory('anonymous')
  })
  it('轻量列表不读取原图；新原图以 Blob 保存，不调用完整 arrayBuffer', async () => {
    const source = record('large', '2026-09-30T12:00:00.000Z')
    const read = vi.spyOn(source.result, 'arrayBuffer')
    await recordWorkstationHistory(OWNER_A, source)
    expect(read).not.toHaveBeenCalled()
    const get = vi.spyOn(IDBObjectStore.prototype, 'get')
    const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll')
    const items = await listHistoryPreviews(OWNER_A)
    expect(items).toHaveLength(1)
    expect(items[0]).not.toHaveProperty('result')
    expect(get.mock.contexts.some(store => (store as unknown as IDBObjectStore).name === 'workstationResults')).toBe(false)
    expect(getAll.mock.contexts.some(store => (store as unknown as IDBObjectStore).name === 'workstationResults')).toBe(false)
    get.mockRestore(); getAll.mockRestore()
  })
  it('保存空间不足回滚整个事务，原历史保留', async () => {
    await recordWorkstationHistory(OWNER_A, record('keep', '2026-09-30T12:00:00.000Z'))
    const original = IDBObjectStore.prototype.put
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === 'workstationResults') throw new DOMException('空间不足', 'QuotaExceededError')
      return original.apply(this, args)
    })
    await expect(recordWorkstationHistory(OWNER_A, record('new', '2026-09-30T13:00:00.000Z'))).rejects.toMatchObject({ name: 'QuotaExceededError' })
    put.mockRestore()
    expect((await listHistoryMetadata(OWNER_A)).map(item => item.id)).toEqual(['keep'])
    expect((await readHistoryImage(OWNER_A, { id: 'keep' }))?.size).toBe(4)
  })
  it('首页只读最近八项缩略图，不补读原图、不删过期视频，账号分别筛选', async () => {
    const db = await openHistoryDatabase()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['metadata', 'thumbnails'], 'readwrite')
      for (let index = 0; index < 10; index++) {
        const { result: _result, ...fields } = record(`本机${index}`, new Date(Date.UTC(2026, 9, 5, index)).toISOString()); void _result
        tx.objectStore('metadata').put({ ownerId: OWNER_A, ...fields })
        if (index !== 9) tx.objectStore('thumbnails').put({ ownerId: OWNER_A, id: fields.id, thumbnail: new Blob(['缩略图']) })
      }
      tx.objectStore('metadata').put({ ...record('其他账号', '2026-10-05T11:00:00Z'), result: undefined, ownerId: OWNER_B })
      tx.objectStore('metadata').put({ ...record('过期视频', '2026-10-05T12:00:00Z'), result: undefined, ownerId: OWNER_A, mediaType: 'video', video: { retentionExpiresAt: '2000-01-01' } })
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error)
    })
    db.close()
    const get = vi.spyOn(IDBObjectStore.prototype, 'get')
    const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll')
    const remove = vi.spyOn(IDBObjectStore.prototype, 'delete')
    const items = await listHistoryPreviews(OWNER_A, true, { limit: 8, readOnly: true })
    expect(items.map(item => item.id)).toEqual(['本机9', '本机8', '本机7', '本机6', '本机5', '本机4', '本机3', '本机2'])
    expect(items[0].thumbnail).toBeUndefined()
    expect(get.mock.contexts.map(store => (store as IDBObjectStore).name)).toEqual(Array(8).fill('thumbnails'))
    expect(getAll.mock.contexts.some(store => (store as IDBObjectStore).name === 'workstationResults')).toBe(false)
    expect(remove).not.toHaveBeenCalled()
    get.mockRestore(); getAll.mockRestore(); remove.mockRestore()
    expect((await listHistoryPreviews(OWNER_B, true, { limit: 8, readOnly: true })).map(item => item.id)).toEqual(['其他账号'])
    const verify = await openHistoryDatabase()
    const expired = await new Promise(resolve => {
      const request = verify.transaction('metadata').objectStore('metadata').get([OWNER_A, '过期视频'])
      request.onsuccess = () => resolve(request.result)
    })
    verify.close()
    expect(expired).toBeTruthy()
  })
  it('主动删除保留对象标记，正常 50 条淘汰不写删除标记', async () => {
    await recordWorkstationHistory(OWNER_A, { ...record('result', '2026-09-30T12:00:00.000Z'), objectKey: 'key', taskId: 'task', ordinal: 2 })
    await deleteWorkstationHistory(OWNER_A, 'result')
    expect(await listHistoryDeletions(OWNER_A)).toEqual([expect.objectContaining({ id: 'result', objectKey: 'key', taskId: 'task' })])
    await recordWorkstationHistory(OWNER_A, record('result', '2026-09-30T12:00:00.000Z'))
    expect(await listHistoryMetadata(OWNER_A)).toEqual([])
  })
  it('旧库升级被中断后重试继续，ArrayBuffer 原图完整保留', async () => {
    await new Promise<void>(resolve => { const request = indexedDB.deleteDatabase('pixel-aigc-history-v2'); request.onsuccess = () => resolve() })
    const db = await new Promise<IDBDatabase>(resolve => {
      const request = indexedDB.open('pixel-aigc-history-v2', 1)
      request.onupgradeneeded = () => { const store = request.result.createObjectStore('workstationResults', { keyPath: ['ownerId', 'id'] }); store.createIndex('ownerId', 'ownerId') }
      request.onsuccess = () => resolve(request.result)
    })
    const bytes = new Uint8Array([255, 216, 255, 224])
    await new Promise<void>(resolve => {
      const tx = db.transaction('workstationResults', 'readwrite')
      const { result: _result, ...fields } = record('old', '2026-09-30T12:00:00.000Z'); void _result
      tx.objectStore('workstationResults').put({ ...fields, ownerId: OWNER_A, resultBytes: bytes.buffer }); tx.oncomplete = () => resolve()
    })
    db.close()
    await new Promise<void>(resolve => {
      const request = indexedDB.open('pixel-aigc-history-v2', 2)
      request.onupgradeneeded = () => request.transaction!.abort()
      request.onerror = () => resolve()
    })
    expect((await listHistoryMetadata(OWNER_A)).map(item => item.id)).toEqual(['old'])
    expect(new Uint8Array(await (await readHistoryImage(OWNER_A, { id: 'old' }))!.arrayBuffer())).toEqual(bytes)
  })
  it('多标签页升级阻塞有明确提示，关闭旧连接后可以重试', async () => {
    await new Promise<void>(resolve => { const request = indexedDB.deleteDatabase('pixel-aigc-history-v2'); request.onsuccess = () => resolve() })
    const held = await new Promise<IDBDatabase>(resolve => {
      const request = indexedDB.open('pixel-aigc-history-v2', 1)
      request.onupgradeneeded = () => { const store = request.result.createObjectStore('workstationResults', { keyPath: ['ownerId', 'id'] }); store.createIndex('ownerId', 'ownerId') }
      request.onsuccess = () => resolve(request.result)
    })
    await expect(openHistoryDatabase()).rejects.toThrow('请关闭其他页面')
    held.close()
    expect(await listHistoryMetadata(OWNER_A)).toEqual([])
  })

  it('同一对象保留已有 ID，删除后换 ID 补记也不能复活', async () => {
    await recordWorkstationHistory(OWNER_A, { ...record('legacy:0', '2026-09-30T12:00:00.000Z'), objectKey: 'stable-key' })
    await recordWorkstationHistory(OWNER_A, { ...record('new:o2', '2026-09-30T12:00:00.000Z'), objectKey: 'stable-key' })
    expect((await listHistoryMetadata(OWNER_A)).map(item => item.id)).toEqual(['legacy:0'])
    await deleteWorkstationHistory(OWNER_A, 'legacy:0')
    await recordWorkstationHistory(OWNER_A, { ...record('new:o2', '2026-09-30T12:00:00.000Z'), objectKey: 'stable-key' })
    expect(await listHistoryMetadata(OWNER_A)).toEqual([])
  })

  it('视频仅存轻量记录，不读写原件或生成缩略图，并尊重删除标记', async () => {
    const expiry = new Date(Date.now() + 86400_000).toISOString()
    const video = { objectKey: 'video-key', ordinal: 0, width: 1280, height: 720, durationSeconds: 5, sizeBytes: 1234, hasAudio: false,
      mimeType: 'video/mp4' as const, retentionExpiresAt: expiry }
    const item = { ...record('video:o0', new Date().toISOString()), result: undefined, objectKey: video.objectKey, mimeType: 'video/mp4', mediaType: 'video' as const, video }
    const write = vi.spyOn(IDBObjectStore.prototype, 'put')
    await recordVideoHistory(OWNER_A, item)
    expect(write.mock.contexts.every(store => (store as IDBObjectStore).name !== 'workstationResults')).toBe(true)
    write.mockRestore()
    expect(await listHistoryMetadata(OWNER_A)).toEqual([])
    expect((await listHistoryPreviews(OWNER_A, true))[0]).toMatchObject({ mediaType: 'video', video })
    expect(await readHistoryImage(OWNER_A, { id: item.id })).toBeUndefined()
    await deleteWorkstationHistory(OWNER_A, item.id)
    await recordVideoHistory(OWNER_A, { ...item, id: 'other:o0' })
    expect(await listHistoryMetadata(OWNER_A, true)).toEqual([])
  })

  it('到期清理视频元数据，其他账号的视频不受影响', async () => {
    const video = { objectKey: 'video-key', ordinal: 0, width: 1280, height: 720, durationSeconds: 5, sizeBytes: 1234, hasAudio: false,
      mimeType: 'video/mp4' as const, retentionExpiresAt: new Date(Date.now() + 2000).toISOString() }
    const item = { ...record('video:o0', new Date().toISOString()), objectKey: video.objectKey, mimeType: 'video/mp4', mediaType: 'video' as const, video }
    await recordVideoHistory(OWNER_A, item)
    await recordVideoHistory(OWNER_B, { ...item, video: { ...video, retentionExpiresAt: new Date(Date.now() + 86400_000).toISOString() } })
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3000)
    expect(await listHistoryMetadata(OWNER_A, true)).toEqual([])
    expect(await listHistoryMetadata(OWNER_B, true)).toHaveLength(1)
    now.mockRestore()
    const db = await openHistoryDatabase()
    const stored = await new Promise(resolve => {
      const request = db.transaction('metadata').objectStore('metadata').get([OWNER_A, item.id])
      request.onsuccess = () => resolve(request.result)
    })
    db.close()
    expect(stored).toBeUndefined()
  })

})
