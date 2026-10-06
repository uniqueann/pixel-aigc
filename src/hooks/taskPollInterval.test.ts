import { describe, expect, it } from 'vitest'
import { Capability } from '@/types'
import {
  BAILIAN_POLL_INTERVAL_MS,
  IMAGE_POLL_INTERVAL_MS,
  VIDEO_POLL_INTERVAL_MS,
  taskRefetchIntervalMs,
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
})
