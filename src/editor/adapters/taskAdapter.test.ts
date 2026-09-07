import { describe, expect, it } from 'vitest'
import { Capability, type GenerationTask } from '@/types'
import { adaptGenerationTask } from './taskAdapter'

const task: GenerationTask<{ prompt: string }> = {
  id: 'task-1',
  capability: Capability.TextToImage,
  status: 'succeeded',
  params: { prompt: '商品图' },
  resultUrls: ['https://example.com/result.png'],
  creditsCost: 1,
  createdAt: '2026-09-06T00:00:00.000Z',
  updatedAt: '2026-09-06T00:01:00.000Z',
}

describe('GenerationTask Adapter', () => {
  it('把 API Task 转换为 GenerationJob 和 Asset', () => {
    const adapted = adaptGenerationTask(task, {
      inputAssetIds: ['asset-input'],
      outputSize: { width: 1024, height: 1024 },
    })

    expect(adapted.generation).toMatchObject({
      id: 'generation:task-1',
      backendTaskId: 'task-1',
      inputAssetIds: ['asset-input'],
      outputAssetIds: ['asset:task-1:0'],
    })
    expect(adapted.assets[0]).toMatchObject({
      id: 'asset:task-1:0',
      type: 'image',
      generationId: 'generation:task-1',
      width: 1024,
      height: 1024,
    })
  })

  it('对同一个任务产生稳定 ID', () => {
    const first = adaptGenerationTask(task)
    const second = adaptGenerationTask(task)
    expect(second.generation.id).toBe(first.generation.id)
    expect(second.assets[0].id).toBe(first.assets[0].id)
  })

  it('把文生视频结果转换为带时长的 VideoAsset', () => {
    const adapted = adaptGenerationTask({
      ...task,
      id: 'task-video',
      capability: Capability.TextToVideo,
      resultUrls: ['https://example.com/result.mp4'],
    }, {
      outputSize: { width: 1280, height: 720 },
      outputDuration: 10,
    })

    expect(adapted.assets[0]).toMatchObject({
      type: 'video',
      width: 1280,
      height: 720,
      duration: 10,
      mimeType: 'video/mp4',
    })
  })
})
