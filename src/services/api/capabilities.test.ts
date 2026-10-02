import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Capability } from '@/types'
import { loadCapabilityFlags, loadImageEditConfigured, loadVariationConfigured } from './capabilities'
import { liveCapabilityReady, registerLiveCapability } from './task'

describe('能力开关注册范围', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    registerLiveCapability(Capability.ImageEdit, false)
    registerLiveCapability(Capability.Variation, false)
  })

  afterEach(() => {
    registerLiveCapability(Capability.ImageEdit, false)
    registerLiveCapability(Capability.Variation, false)
    vi.unstubAllGlobals()
  })

  it('智能编辑会注册到全局任务能力', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ imageEdit: true, variation: true }) })
    await expect(loadImageEditConfigured()).resolves.toBe(true)
    expect(liveCapabilityReady(Capability.ImageEdit, false)).toBe(true)
  })

  it('裂变只返回工作站开关，不注册成全局任务能力', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ imageEdit: true, variation: true }) })
    await expect(loadVariationConfigured()).resolves.toBe(true)
    expect(liveCapabilityReady(Capability.Variation, false)).toBe(false)
  })

  it('服务端错误和网络失败不会被伪装成未配置', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false })
    await expect(loadCapabilityFlags()).rejects.toThrow('功能配置加载失败，请重试')
    fetchMock.mockRejectedValueOnce(new Error('网络错误'))
    await expect(loadCapabilityFlags()).rejects.toThrow('网络错误')
  })
})
