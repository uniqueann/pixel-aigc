import { describe, expect, it } from 'vitest'
import { createImageAsset } from '@/editor/services/assetService'
import { Capability, type GenerationTask } from '@/types'
import { excludeSourceEchoes, finalizeWorkstationResults, readSourceImageUrl } from './results'

const source = createImageAsset({
  id: 'asset:source',
  name: '原图',
  url: 'source.png',
  width: 640,
  height: 480,
})

function task(status: GenerationTask['status'], resultUrls?: string[]): GenerationTask {
  return {
    id: 'task-1',
    capability: Capability.Variation,
    status,
    params: { sourceImageUrl: source.url },
    resultUrls,
    creditsCost: 1,
    createdAt: '2026-09-27T00:00:00.000Z',
    updatedAt: '2026-09-27T00:00:00.000Z',
  }
}

describe('工作站生成结果', () => {
  it('读取任务里的原图地址', () => {
    expect(readSourceImageUrl({ sourceImageUrl: 'source.png' })).toBe('source.png')
    expect(readSourceImageUrl({ prompt: '无原图' })).toBeUndefined()
  })

  it('丢掉与原图同一地址的占位结果', () => {
    const echo = createImageAsset({ ...source, id: 'asset:echo', url: source.url, source: 'generation' })
    const real = createImageAsset({ id: 'asset:real', name: '结果', url: 'result.png', width: 640, height: 480, source: 'generation' })
    expect(excludeSourceEchoes(task('succeeded', [source.url, 'result.png']), [echo, real])).toEqual([real])
  })

  it('成功但只回传原图时给出明确错误，不能当生成结果', () => {
    const echo = createImageAsset({ ...source, id: 'asset:echo', url: source.url, source: 'generation' })
    expect(finalizeWorkstationResults(task('succeeded', [source.url]), [echo])).toEqual({
      assets: [],
      error: '任务已完成，但没有返回新的生成结果',
    })
    expect(finalizeWorkstationResults(task('succeeded'), [])).toEqual({
      assets: [],
      error: '任务已完成，但接口没有返回图片结果',
    })
    expect(finalizeWorkstationResults(task('processing'), [echo])).toEqual({ assets: [] })
  })
})
