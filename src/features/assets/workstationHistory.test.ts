// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { Capability } from '@/types'
import { resolveWorkstationHistoryOwner } from './historyOwner'
import {
  clearWorkstationHistory,
  deleteWorkstationHistory,
  listWorkstationHistory,
  recordWorkstationHistory,
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
})
