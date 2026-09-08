import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Capability,
  type EmailAssistTaskParams,
  type ImageEditTaskParams,
  type TextToImageTaskParams,
  type TextToVideoTaskParams,
  type VariationTaskParams,
} from '@/types'
import { createMockTask, getMockTask, resetMockTasks } from './mockTaskGateway'

describe('mockTaskGateway', () => {
  beforeEach(() => resetMockTasks())

  it('用稳定的轮询阶段生成指定数量的本地图片', async () => {
    const params: TextToImageTaskParams = {
      prompt: '测试画面',
      size: { width: 1024, height: 768 },
      count: 3,
    }
    const created = await createMockTask({
      capability: Capability.TextToImage,
      requestId: 'request-1',
      params,
    })

    expect(created).toMatchObject({ id: 'mock:request-1', status: 'queued', params })
    await expect(getMockTask(created.id)).resolves.toMatchObject({ status: 'processing' })
    const completed = await getMockTask(created.id)
    expect(completed.status).toBe('succeeded')
    expect(completed.resultUrls).toHaveLength(3)
    expect(completed.resultUrls?.every((url) => url.startsWith('data:image/svg+xml'))).toBe(true)
  })

  it('为智能编辑生成可区分的图片候选', async () => {
    const params: ImageEditTaskParams = {
      sourceImageUrl: 'source.png',
      prompt: '更换背景',
      count: 2,
      resolution: '2k',
      size: { width: 2048, height: 1536 },
    }
    const created = await createMockTask({ capability: Capability.ImageEdit, requestId: 'edit-1', params })
    await getMockTask(created.id)
    const completed = await getMockTask(created.id)
    expect(completed.resultUrls).toHaveLength(2)
    expect(completed.resultUrls?.[0]).not.toBe(completed.resultUrls?.[1])
  })

  it('为图片裂变生成指定数量的候选', async () => {
    const params: VariationTaskParams = {
      sourceImageUrl: 'source.png',
      prompt: '改变光线',
      size: { width: 1280, height: 720 },
      count: 4,
    }
    const created = await createMockTask({ capability: Capability.Variation, requestId: 'variation-1', params })
    await getMockTask(created.id)
    const completed = await getMockTask(created.id)
    expect(completed.resultUrls).toHaveLength(4)
    expect(completed.resultUrls?.every((url) => url.startsWith('data:image/svg+xml'))).toBe(true)
  })

  it('为文生视频返回与时长匹配的本地视频', async () => {
    const params: TextToVideoTaskParams = {
      prompt: '云海日出延时摄影',
      size: { width: 1280, height: 720 },
      durationSeconds: 10,
      count: 1,
    }
    const created = await createMockTask({ capability: Capability.TextToVideo, requestId: 'video-1', params })
    await getMockTask(created.id)
    const completed = await getMockTask(created.id)
    expect(completed.resultUrls).toEqual(['/mock/text-to-video-10s.mp4'])
  })

  it('为邮件助手返回单条文本结果', async () => {
    const params: EmailAssistTaskParams = {
      sourceText: '请问订单什么时候发货？',
      operation: 'reply',
      language: 'zh',
      instruction: '礼貌说明明天发货',
    }
    const created = await createMockTask({ capability: Capability.EmailAssist, requestId: 'email-1', params })
    await getMockTask(created.id)
    const completed = await getMockTask(created.id)
    expect(completed.resultText).toContain('建议回复')
    expect(completed.resultText).toContain('礼貌说明明天发货')
    expect(completed.resultUrls).toBeUndefined()
  })
  it('重复幂等键返回原任务，模块重载后仍能查询且终态不变化', async () => {
    const payload = { capability: Capability.TextToImage, requestId: 'durable-mock', params: { prompt: '持久化', size: { width: 512, height: 512 }, count: 1 } }
    const original = await createMockTask(payload)
    expect(await createMockTask(payload)).toEqual(original)
    await getMockTask(original.id)
    vi.resetModules()
    const reloaded = await import('./mockTaskGateway')
    const completed = await reloaded.getMockTask(original.id)
    expect(completed.status).toBe('succeeded')
    expect(await reloaded.getMockTask(original.id)).toEqual(completed)
    await reloaded.cancelMockTask(original.id)
    expect(await reloaded.getMockTask(original.id)).toEqual(completed)
  })

})
