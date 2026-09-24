import { describe, expect, it, vi } from 'vitest'
import { invalidateBatch, processBatch } from './batch'
import { DEFAULT_ASPECT_RATIO_SETTINGS, type BatchImage } from './types'

function item(id: string): BatchImage {
  return {
    id, file: new File(['source'], `${id}.png`, { type: 'image/png' }), sourceMime: 'image/png',
    sourceUrl: '', width: 100, height: 80, status: 'pending',
  }
}

describe('转比例批量状态', () => {
  it('单张失败不阻断后续图片，并可只重试失败项', async () => {
    let images = [item('a'), item('b')]
    const update = (id: string, patch: Partial<BatchImage>) => {
      images = images.map(image => image.id === id ? { ...image, ...patch } : image)
    }
    const render = vi.fn(async ({ file }: { file: File }) => {
      if (file.name === 'b.png') throw new Error('编码失败')
      return { blob: new Blob(['ok'], { type: 'image/jpeg' }), mimeType: 'image/jpeg', width: 1600, height: 1600 }
    })
    await processBatch({
      images, settings: DEFAULT_ASPECT_RATIO_SETTINGS, targetWidth: 1600, targetHeight: 1600,
      render, update, shouldStop: () => false,
    })
    expect(images.map(image => image.status)).toEqual(['succeeded', 'failed'])
    render.mockImplementation(async () => ({ blob: new Blob(['ok']), mimeType: 'image/jpeg', width: 1600, height: 1600 }))
    await processBatch({
      images, settings: DEFAULT_ASPECT_RATIO_SETTINGS, targetWidth: 1600, targetHeight: 1600,
      ids: ['b'], render, update, shouldStop: () => false,
    })
    expect(images[1].status).toBe('succeeded')
  })

  it('输出尺寸不符时整项失败，改设置会作废结果', async () => {
    let images = [item('a')]
    const update = (id: string, patch: Partial<BatchImage>) => {
      images = images.map(image => image.id === id ? { ...image, ...patch } : image)
    }
    await processBatch({
      images, settings: DEFAULT_ASPECT_RATIO_SETTINGS, targetWidth: 1600, targetHeight: 1600,
      render: async () => ({ blob: new Blob(['bad']), mimeType: 'image/jpeg', width: 100, height: 100 }),
      update, shouldStop: () => false,
    })
    expect(images[0].status).toBe('failed')
    images[0] = { ...images[0], status: 'succeeded', output: new Blob(['old']) }
    expect(invalidateBatch(images)[0].output).toBeUndefined()
  })
})
