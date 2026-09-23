import { describe, expect, it, vi } from 'vitest'
import { invalidateBatch, processBatch } from './batch'
import { DEFAULT_WATERMARK_SETTINGS, type BatchImage } from './types'

function item(id: string): BatchImage {
  return {
    id, file: new File(['source'], `${id}.png`, { type: 'image/png' }), sourceMime: 'image/png',
    sourceUrl: '', width: 100, height: 100, status: 'pending',
  }
}

describe('批量处理状态', () => {
  it('单张失败不阻断后续图片，并可仅重试失败项', async () => {
    let images = [item('a'), item('b'), item('c')]
    const update = (id: string, patch: Partial<BatchImage>) => {
      images = images.map(image => image.id === id ? { ...image, ...patch } : image)
    }
    const output = new Blob(['result'], { type: 'image/png' })
    const render = vi.fn(async ({ file }: { file: File }) => {
      if (file.name === 'b.png') throw new Error('编码失败')
      return { blob: output, mimeType: 'image/png', width: 100, height: 100 }
    })
    await processBatch({ images, settings: DEFAULT_WATERMARK_SETTINGS, render, update, shouldStop: () => false })
    expect(images.map(image => image.status)).toEqual(['succeeded', 'failed', 'succeeded'])
    expect(images[1].error).toBe('编码失败')

    render.mockImplementation(async () => ({ blob: output, mimeType: 'image/png', width: 100, height: 100 }))
    await processBatch({ images, settings: DEFAULT_WATERMARK_SETTINGS, ids: ['b'], render, update, shouldStop: () => false })
    expect(images.map(image => image.status)).toEqual(['succeeded', 'succeeded', 'succeeded'])
    expect(render).toHaveBeenCalledTimes(4)
  })

  it('取消后当前项回到待处理，参数变化使所有旧结果失效', async () => {
    let images = [item('a'), item('b')]
    let stopped = false
    const update = (id: string, patch: Partial<BatchImage>) => {
      images = images.map(image => image.id === id ? { ...image, ...patch } : image)
    }
    await processBatch({
      images, settings: DEFAULT_WATERMARK_SETTINGS,
      render: async () => { stopped = true; return { blob: new Blob(['result']), mimeType: 'image/png', width: 100, height: 100 } },
      update, shouldStop: () => stopped,
    })
    expect(images.map(image => image.status)).toEqual(['pending', 'pending'])

    images[0] = { ...images[0], status: 'succeeded', output: new Blob(['old']), outputMime: 'image/png' }
    expect(invalidateBatch(images).map(image => [image.status, image.output])).toEqual([['pending', undefined], ['pending', undefined]])
  })
})
