// @vitest-environment node
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Capability, type GenerationTask } from '@/types'
import { useUserStore } from '@/store/useUserStore'
import { deleteWorkstationHistory, listHistoryMetadata, readHistoryImage } from '@/features/assets/workstationHistory'
import { saveCanvasTaskHistory } from './history'

const OWNER = '11111111-1111-4111-8111-111111111111'
const mocks = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('@/cloud/client', () => ({ authEnabled: true, cloudEnabled: false }))
vi.mock('@/services/api/ownedImages', () => ({ readOwnedImage: mocks.read }))
vi.mock('@/services/api/task', () => ({ getTask: vi.fn(), listTasks: vi.fn() }))
const task: GenerationTask<unknown> = {
  id: 'canvas-result', capability: Capability.Variation, status: 'succeeded',
  params: { prompt: '变换光线' }, creditsCost: 6, createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:01:00Z',
  resultImages: [1, 3].map(ordinal => ({ ordinal, objectKey: `owned-${ordinal}`, url: `https://images.example/${ordinal}.png`, expiresAt: Date.now(), width: 2048, height: 1152, mimeType: 'image/png' })),
}
beforeEach(async () => {
  vi.resetAllMocks()
  useUserStore.setState({ userId: OWNER })
  await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase('pixel-aigc-history-v2'); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error) })
  mocks.read.mockResolvedValue(new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }))
})
afterEach(() => useUserStore.setState({ userId: null }))

describe('画布生成结果补记资产', () => {
  it('按工作站的稳定序号保存完整图片，多次补存不会重复记录', async () => {
    await saveCanvasTaskHistory(task, OWNER)
    await saveCanvasTaskHistory(task, OWNER)
    expect((await listHistoryMetadata(OWNER)).map(item => item.id).sort()).toEqual(['canvas-result:o1', 'canvas-result:o3'])
    const saved = await readHistoryImage(OWNER, { objectKey: 'owned-3' })
    expect(saved?.type).toBe('image/png')
    expect(saved?.size).toBe(8)
    expect(mocks.read.mock.calls.every(call => call[1].ownerId === OWNER)).toBe(true)
  })

  it('已主动删除的结果不会被再次补存或下载', async () => {
    await saveCanvasTaskHistory(task, OWNER)
    await deleteWorkstationHistory(OWNER, 'canvas-result:o1')
    mocks.read.mockClear()
    await saveCanvasTaskHistory(task, OWNER)
    expect((await listHistoryMetadata(OWNER)).map(item => item.id)).toEqual(['canvas-result:o3'])
    expect(mocks.read).toHaveBeenCalledTimes(1)
    expect(mocks.read.mock.calls[0][0].objectKey).toBe('owned-3')
  })

  it('一张读取失败时其余结果仍保存，重试只得到同一组稳定记录', async () => {
    mocks.read.mockRejectedValueOnce(new Error('读取失败'))
    await expect(saveCanvasTaskHistory(task, OWNER)).rejects.toThrow('部分图片未保存')
    expect(await listHistoryMetadata(OWNER)).toHaveLength(1)
    await saveCanvasTaskHistory(task, OWNER)
    expect(await listHistoryMetadata(OWNER)).toHaveLength(2)
  })

  it('账号切换后旧异步结果不会保存到任何账号的资产', async () => {
    mocks.read.mockImplementation(async () => {
      useUserStore.setState({ userId: '22222222-2222-4222-8222-222222222222' })
      return new Blob(['旧结果'], { type: 'image/png' })
    })
    await expect(saveCanvasTaskHistory(task, OWNER)).rejects.toThrow('部分图片未保存')
    expect(await listHistoryMetadata(OWNER)).toEqual([])
  })
})
