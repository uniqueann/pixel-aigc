import { describe, expect, it, vi } from 'vitest'
import { Capability, type GenerationTask, type InpaintTaskParams } from '@/types'
import type { CreateTaskPayload } from '@/services/api/task'
import { GenerationService } from './generationService'

describe('GenerationService', () => {
  it('提交任务后分别注册 GenerationJob 和输出 Asset', async () => {
    const params: InpaintTaskParams = {
      sourceImageUrl: 'source.png',
      maskUrl: 'mask.png',
      mode: 'remove',
    }
    const task: GenerationTask<InpaintTaskParams> = {
      id: 'task-service',
      capability: Capability.Inpaint,
      status: 'succeeded',
      params,
      resultUrls: ['result.png'],
      creditsCost: 1,
      createdAt: '2026-09-06T00:00:00.000Z',
      updatedAt: '2026-09-06T00:01:00.000Z',
    }
    const registerAsset = vi.fn()
    const registerGeneration = vi.fn()
    const createTaskSpy = vi.fn()
    const createTask = async <TParams,>(payload: CreateTaskPayload<TParams>): Promise<GenerationTask<TParams>> => {
      createTaskSpy(payload)
      return task as unknown as GenerationTask<TParams>
    }
    const service = new GenerationService({ registerAsset, registerGeneration }, createTask)

    const result = await service.submit({
      capability: Capability.Inpaint,
      requestId: 'request-1',
      params,
    }, {
      inputAssetIds: ['source-asset'],
      outputSize: { width: 640, height: 480 },
    })

    expect(createTaskSpy).toHaveBeenCalledOnce()
    expect(registerGeneration).toHaveBeenCalledWith(result.generation)
    expect(registerAsset).toHaveBeenCalledWith(result.assets[0])
    expect(result.generation.outputAssetIds).toEqual([result.assets[0].id])
  })
})
