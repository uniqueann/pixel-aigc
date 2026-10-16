import { describe, expect, it } from 'vitest'
import { Capability } from '@/types'
import {
  BAILIAN_POLL_INTERVAL_MS,
  IMAGE_POLL_INTERVAL_MS,
  VIDEO_POLL_INTERVAL_MS,
  taskRefetchIntervalMs,
  taskPollDecision,
} from './taskPollInterval'

describe('任务轮询间隔', () => {
  it('视频 5 秒，普通图片 2 秒，百炼 1 秒，终态停止', () => {
    expect(taskRefetchIntervalMs({ status: 'processing', capability: Capability.TextToVideo })).toBe(VIDEO_POLL_INTERVAL_MS)
    expect(taskRefetchIntervalMs({ status: 'processing', capability: Capability.TextToImage, modelProfileId: 'dragoncode:gpt-image-2' })).toBe(IMAGE_POLL_INTERVAL_MS)
    expect(taskRefetchIntervalMs({ status: 'queued', capability: Capability.TextToImage })).toBe(IMAGE_POLL_INTERVAL_MS)
    expect(taskRefetchIntervalMs({ status: 'processing', capability: Capability.TextToImage, modelProfileId: 'bailian:qwen-image-3.0-pro' })).toBe(BAILIAN_POLL_INTERVAL_MS)
    expect(taskRefetchIntervalMs({ status: 'succeeded', capability: Capability.TextToImage, modelProfileId: 'bailian:qwen-image-3.0' })).toBe(false)
    expect(taskRefetchIntervalMs(undefined)).toBe(false)
  })
  it('图片按服务端时间查询，缓存观察者扣除已经等待的时间', () => {
    const task = { status: 'processing' as const, capability: Capability.ImageEdit, pollAfterMs: 5_000 }
    expect(taskRefetchIntervalMs(task)).toBe(5_000)
    expect(taskRefetchIntervalMs(task, 2_000)).toBe(3_000)
    expect(taskRefetchIntervalMs(task, 20_000)).toBe(1_000)
    expect(taskRefetchIntervalMs({ ...task, pollAfterMs: NaN })).toBe(IMAGE_POLL_INTERVAL_MS)
    expect(taskRefetchIntervalMs({ ...task, status: 'succeeded' })).toBe(false)
    expect(taskRefetchIntervalMs({ ...task, capability: Capability.TextToVideo })).toBe(VIDEO_POLL_INTERVAL_MS)
  })
  it('区分无提示与无效提示，选择结果与实际间隔使用同一决策', () => {
    expect(taskPollDecision({ status: 'processing' })).toMatchObject({ source: 'fallback', fallbackReason: 'missing_hint', intervalMs: 2_000 })
    expect(taskPollDecision({ status: 'processing', pollAfterMs: -1 })).toMatchObject({ source: 'fallback', fallbackReason: 'invalid_hint', pollAfterMs: null })
  })
})
