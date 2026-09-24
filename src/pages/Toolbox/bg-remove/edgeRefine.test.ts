import { describe, expect, it, vi } from 'vitest'
import { recompositeBatch } from './batch'
import { applyEdgeRefinePixels, canRefineEdge, sampleRefineMarks } from './edgeRefine'
import { applyEdgeRefineResult, loadBgRemoveSession, saveBgRemoveSession, setEdgeRefineHandoff, takeEdgeRefineHandoff, takeEdgeRefineResult, setEdgeRefineResult, clearBgRemoveSession } from './session'
import type { BatchImage } from './types'

function rgba(pixels: number[][]) {
  const data = new Uint8ClampedArray(pixels.length * 4)
  pixels.forEach((pixel, index) => {
    data.set(pixel, index * 4)
  })
  return data
}

describe('边缘精修像素', () => {
  it('画笔变透明，橡皮擦从原图恢复，其余像素和尺寸不变', () => {
    const source = rgba([[10, 20, 30, 255], [40, 50, 60, 255], [70, 80, 90, 255], [1, 2, 3, 255]])
    const matte = rgba([[10, 20, 30, 255], [0, 0, 0, 0], [70, 80, 90, 200], [9, 9, 9, 255]])
    const output = applyEdgeRefinePixels(source, matte, Uint8Array.from([1, 0, 0, 0]), Uint8Array.from([0, 1, 0, 0]))
    expect(output).toEqual(rgba([[10, 20, 30, 0], [40, 50, 60, 255], [70, 80, 90, 200], [9, 9, 9, 255]]))
  })

  it('只采样包含区域内的红笔和蓝笔，留白笔迹不影响原图', () => {
    const canvas = new Uint8ClampedArray(4 * 2 * 4)
    canvas.set([255, 0, 0, 255], 0)
    canvas.set([255, 0, 0, 255], 4)
    canvas.set([0, 80, 255, 255], 8)
    const marks = sampleRefineMarks(canvas, 4, 2, 2, 2)
    expect(Array.from(marks.remove)).toEqual([1, 0, 0, 0])
    expect(Array.from(marks.restore)).toEqual([0, 1, 0, 0])
  })

  it('没有透明结果时不能修边缘', () => {
    expect(canRefineEdge({ status: 'succeeded' })).toBe(false)
    expect(canRefineEdge({ status: 'failed', matte: new Blob(['m']) })).toBe(false)
    expect(canRefineEdge({ status: 'succeeded', matte: new Blob(['m']) })).toBe(true)
  })
})

describe('边缘精修交接', () => {
  it('取消保留原透明底，完成后换背景使用新透明底且不再抠图', async () => {
    clearBgRemoveSession()
    const matte = new Blob(['old'])
    const image: BatchImage = {
      id: 'a', file: new File(['s'], 'a.png'), sourceMime: 'image/png', sourceUrl: 'blob:a',
      width: 2, height: 2, status: 'succeeded', matte,
    }
    expect(applyEdgeRefineResult([image], { itemId: 'a', matte: null, cancelled: true })[0].matte).toBe(matte)
    const nextMatte = new Blob(['new'])
    const updated = applyEdgeRefineResult([image], { itemId: 'a', matte: nextMatte, cancelled: false })
    const remove = vi.fn()
    const compose = vi.fn(async (_image: BatchImage, current: Blob) => ({ blob: current, mimeType: 'image/png' }))
    let images = updated
    await recompositeBatch(images, compose, (id, patch) => {
      images = images.map(item => item.id === id ? { ...item, ...patch } : item)
    })
    expect(remove).not.toHaveBeenCalled()
    expect(compose).toHaveBeenCalledWith(expect.objectContaining({ matte: nextMatte }), nextMatte)
    expect(images[0].output).toBe(nextMatte)
  })

  it('离开抠图页后队列还在，交接只取一次', () => {
    clearBgRemoveSession()
    const image: BatchImage = {
      id: 'a', file: new File(['s'], 'a.png'), sourceMime: 'image/png', sourceUrl: 'blob:a',
      width: 2, height: 2, status: 'processing',
    }
    saveBgRemoveSession({ items: [image], settings: { background: '#ffffff' }, selectedId: 'a' })
    expect(loadBgRemoveSession()?.items[0].status).toBe('pending')
    setEdgeRefineHandoff({ itemId: 'a', file: image.file, matte: new Blob(['m']), width: 2, height: 2 })
    expect(takeEdgeRefineHandoff()?.itemId).toBe('a')
    expect(takeEdgeRefineHandoff()).toBeNull()
    setEdgeRefineResult({ itemId: 'a', matte: null, cancelled: true })
    expect(takeEdgeRefineResult()?.cancelled).toBe(true)
    expect(takeEdgeRefineResult()).toBeNull()
  })
})
