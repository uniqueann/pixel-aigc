import { describe, expect, it, vi } from 'vitest'
import { Capability } from '@/types'
import type { WorkstationLiveSession } from './liveSession'

const mocks = vi.hoisted(() => ({ recover: vi.fn(), getTask: vi.fn(), findTask: vi.fn() }))
vi.mock('@/services/api/billing', () => ({ recoverSyncResult: mocks.recover }))
vi.mock('@/services/api/task', () => ({ getTask: mocks.getTask, findTaskByRequest: mocks.findTask }))

import { loadWorkstationLiveTask, watchWorkstationLiveTask } from './resumeLiveTask'

const session: WorkstationLiveSession = {
  v: 1,
  owner: '11111111-1111-4111-8111-111111111111',
  scope: 'preview',
  tool: 'repaint',
  sourceKind: 'sync_credit',
  requestId: '22222222-2222-4222-8222-222222222222',
  sourceId: '22222222-2222-4222-8222-222222222222',
  createdAt: Date.now(),
}

describe('刷新后的工作站任务读取', () => {
  it('同步任务进行中只查询，完成后带回可解码的对象且不重新提交', async () => {
    mocks.recover.mockReset()
    mocks.recover
      .mockResolvedValueOnce({ state: 'reserved' })
      .mockResolvedValueOnce({ state: 'settled', result: { objectKey: 'temporary/repaint-results/u/1.jpg', url: 'https://r2.test/1.jpg', mimeType: 'image/jpeg', expiresAt: 1 } })
    const updates: string[] = []
    const controller = new AbortController()
    await watchWorkstationLiveTask({
      session,
      capability: Capability.Inpaint,
      signal: controller.signal,
      pollMs: 1,
      load: loadWorkstationLiveTask,
      onUpdate: (view) => {
        updates.push(view.phase)
        if (view.phase === 'succeeded') {
          expect(view.task.resultImages?.[0]).toMatchObject({ objectKey: 'temporary/repaint-results/u/1.jpg', width: 0, height: 0 })
          expect(view.task.params).toMatchObject({ mode: 'repaint' })
        }
      },
    })
    expect(updates).toEqual(['processing', 'processing', 'succeeded'])
    expect(mocks.recover).toHaveBeenCalledTimes(2)
    expect(mocks.getTask).not.toHaveBeenCalled()
  })

  it('异步图片任务进行中交给原任务轮询，不另起生成', async () => {
    mocks.getTask.mockReset()
    mocks.getTask.mockResolvedValue({ id: '33333333-3333-4333-8333-333333333333', requestId: session.requestId, capability: Capability.ImageEdit, status: 'processing', params: {}, creditsCost: 1, createdAt: '2026-10-12T00:00:00.000Z', updatedAt: '2026-10-12T00:00:00.000Z' })
    const view = await loadWorkstationLiveTask({ ...session, sourceKind: 'image_job', sourceId: '33333333-3333-4333-8333-333333333333', tool: 'smart-edit' }, Capability.ImageEdit)
    expect(view).toMatchObject({ phase: 'processing', handoff: true })
  })
})
