import { beforeEach, describe, expect, it } from 'vitest'
import { Capability, type TextToImageTaskParams } from '@/types'
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
})
