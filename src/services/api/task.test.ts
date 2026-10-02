import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Capability } from '@/types'

const post = vi.fn()
const get = vi.fn()

vi.mock('./client', () => ({
  apiClient: {
    post: (...args: unknown[]) => post(...args),
    get: (...args: unknown[]) => get(...args),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

import { canCreateLiveTask, createTask, findTaskByRequest, liveCapabilityReady, registerLiveCapability } from './task'

describe('createTask 真实模式接入检查', () => {
  beforeEach(() => {
    post.mockReset()
    get.mockReset()
    post.mockResolvedValue({ id: 'task-1', status: 'queued' })
    registerLiveCapability(Capability.Variation, false)
    registerLiveCapability(Capability.ImageEdit, false)
    registerLiveCapability(Capability.Inpaint, false)
    registerLiveCapability(Capability.Relight, false)
  })

  afterEach(() => {
    registerLiveCapability(Capability.Variation, false)
    registerLiveCapability(Capability.ImageEdit, false)
    registerLiveCapability(Capability.Inpaint, false)
    registerLiveCapability(Capability.Relight, false)
  })

  it('裂变可以提交到 /tasks，即使没有注册为全局 live capability', async () => {
    expect(liveCapabilityReady(Capability.Variation, false)).toBe(false)
    expect(canCreateLiveTask(Capability.Variation, false)).toBe(true)
    await expect(createTask({
      capability: Capability.Variation,
      requestId: '00000000-0000-4000-8000-000000000001',
      params: { count: 1, resolution: '2k' },
    })).resolves.toMatchObject({ id: 'task-1' })
    expect(post).toHaveBeenCalledWith('/tasks', expect.objectContaining({
      capability: Capability.Variation,
    }), { timeout: 55000 })
  })

  it('未接入的能力仍拒绝提交', async () => {
    for (const capability of [Capability.Relight, Capability.Fusion, Capability.Retouch, Capability.Inpaint]) {
      await expect(createTask({
        capability,
        requestId: '00000000-0000-4000-8000-000000000002',
        params: {},
      })).rejects.toThrow('该生成能力尚未接入真实服务')
    }
    expect(post).not.toHaveBeenCalled()
  })

  it('智能编辑仍需全局注册后才能提交', async () => {
    expect(canCreateLiveTask(Capability.ImageEdit, false)).toBe(false)
    await expect(createTask({
      capability: Capability.ImageEdit,
      requestId: '00000000-0000-4000-8000-000000000003',
      params: {},
    })).rejects.toThrow('该生成能力尚未接入真实服务')
    registerLiveCapability(Capability.ImageEdit, true)
    await expect(createTask({
      capability: Capability.ImageEdit,
      requestId: '00000000-0000-4000-8000-000000000004',
      params: {},
    })).resolves.toMatchObject({ id: 'task-1' })
  })

  it('只有查询明确返回 404 才视为不存在，网络或服务异常继续上抛', async () => {
    get.mockRejectedValueOnce(Object.assign(new Error('未找到任务'), { status: 404 }))
    await expect(findTaskByRequest('original-request')).resolves.toBeUndefined()
    get.mockRejectedValueOnce(Object.assign(new Error('服务不可用'), { status: 503 }))
    await expect(findTaskByRequest('original-request')).rejects.toThrow('服务不可用')
    get.mockRejectedValueOnce(new TypeError('网络中断'))
    await expect(findTaskByRequest('original-request')).rejects.toThrow('网络中断')
    expect(post).not.toHaveBeenCalled()
  })
})
