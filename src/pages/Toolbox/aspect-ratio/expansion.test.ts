import { describe, expect, it, vi } from 'vitest'
import { expansionPlan, processOutpaintBatch } from './expansion'
import type { BatchImage } from './types'

function item(id: string, width: number, height: number): BatchImage {
  return {
    id, file: new File(['source'], `${id}.png`, { type: 'image/png' }), sourceMime: 'image/png',
    sourceUrl: '', width, height, status: 'pending',
  }
}

describe('智能扩展计划', () => {
  it('比例一致时不提交扩图', () => {
    expect(expansionPlan(800, 800, 1600, 1600).mode).toBe('local')
  })

  it('横图进方图时保留完整原图并记录留白偏移', () => {
    const plan = expansionPlan(800, 400, 1000, 1000)
    expect(plan.mode).toBe('remote')
    expect(plan.sourceSize).toEqual({ width: 1000, height: 500 })
    expect(plan.originOffset).toEqual({ x: 0, y: 250 })
  })
})

describe('扩图批量并发', () => {
  it('最多同时处理 2 张，单张失败不阻断其他图片', async () => {
    let images = [item('a', 800, 400), item('b', 800, 400), item('c', 800, 800)]
    let active = 0
    let peak = 0
    const update = (id: string, patch: Partial<BatchImage>) => {
      images = images.map(image => image.id === id ? { ...image, ...patch } : image)
    }
    const expandRemote = vi.fn(async (image: BatchImage) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 20))
      active -= 1
      if (image.id === 'b') throw new Error('扩图失败')
      return { blob: new Blob(['remote']), mimeType: 'image/jpeg', width: 1000, height: 1000 }
    })
    await processOutpaintBatch({
      images, settings: { strategy: 'outpaint', selectedPresetId: 'amazon-main', background: '#ffffff', fx: 0.5, fy: 0.5 },
      targetWidth: 1000, targetHeight: 1000, concurrency: 2, update, shouldStop: () => false,
      renderLocal: async () => ({ blob: new Blob(['local']), mimeType: 'image/jpeg', width: 1000, height: 1000 }),
      expandRemote,
    })
    expect(peak).toBeLessThanOrEqual(2)
    expect(expandRemote).toHaveBeenCalledTimes(2)
    expect(images.find(image => image.id === 'c')?.status).toBe('succeeded')
    expect(images.find(image => image.id === 'b')?.status).toBe('failed')
    expect(images.find(image => image.id === 'a')?.status).toBe('succeeded')
  })
})
