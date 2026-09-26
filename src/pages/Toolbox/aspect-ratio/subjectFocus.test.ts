import { describe, expect, it, vi } from 'vitest'
import { CROP_CONCURRENCY, invalidateBatch, processBatch } from './batch'
import { SUBJECT_CROP_NOTE, cropProgressLabel, detectionPixelSize, focusFromSubjectBox, gridCropNote, mockDetectSubject } from './subjectFocus'
import { DEFAULT_ASPECT_RATIO_SETTINGS, type BatchImage } from './types'

function item(id: string, width = 1000, height = 1000): BatchImage {
  return {
    id, file: new File(['source'], `${id}.png`, { type: 'image/png' }), sourceMime: 'image/png',
    sourceUrl: '', width, height, status: 'pending',
  }
}

describe('主体框换算焦点', () => {
  it('把偏上的模拟框放进裁切窗口', () => {
    expect(focusFromSubjectBox(mockDetectSubject().box, 1000, 1000, 1000, 500)).toEqual({ fx: 0.5, fy: 0.05 })
  })

  it('框中心已在画面中心时焦点保持正中', () => {
    expect(focusFromSubjectBox({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, 1000, 1000, 1000, 500)).toEqual({ fx: 0.5, fy: 0.5 })
  })

  it('非法框返回空，调用方保留九宫格焦点', () => {
    expect(focusFromSubjectBox({ x: 0, y: 0, width: 0, height: 0.2 }, 1000, 1000, 1000, 500)).toBeNull()
    expect(focusFromSubjectBox({ x: -0.1, y: 0.1, width: 0.2, height: 0.2 }, 100, 100, 50, 100)).toBeNull()
    expect(focusFromSubjectBox(null, 100, 100, 50, 100)).toBeNull()
  })
})

describe('智能裁剪按张检测', () => {
  it('没有主体时仍裁剪成功并继续下一张', async () => {
    let images = [item('a'), item('b')]
    const update = (id: string, patch: Partial<BatchImage>) => {
      images = images.map(image => image.id === id ? { ...image, ...patch } : image)
    }
    let calls = 0
    const detect = vi.fn(async () => {
      calls += 1
      return calls === 1 ? { box: null } : mockDetectSubject()
    })
    const render = vi.fn(async () => ({ blob: new Blob(['ok']), mimeType: 'image/jpeg', width: 1000, height: 500 }))
    await processBatch({
      images, settings: { ...DEFAULT_ASPECT_RATIO_SETTINGS, strategy: 'crop', fx: 1, fy: 1 },
      targetWidth: 1000, targetHeight: 500, detect, render, update, shouldStop: () => false,
    })
    expect(images.map(image => image.status)).toEqual(['succeeded', 'succeeded'])
    expect(images[0].cropFocus).toMatchObject({ fx: 1, fy: 1, source: 'grid', note: gridCropNote(1, 1) })
    expect(images[1].cropFocus).toMatchObject({ fx: 0.5, fy: 0.05, source: 'subject', note: SUBJECT_CROP_NOTE })
    expect(render).toHaveBeenCalledTimes(2)
  })

  it('检测抛错时退回九宫格，编码失败仍整项失败', async () => {
    let images = [item('a'), item('b')]
    const update = (id: string, patch: Partial<BatchImage>) => {
      images = images.map(image => image.id === id ? { ...image, ...patch } : image)
    }
    const detect = vi.fn(async () => { throw new Error('检测失败') })
    await processBatch({
      images, settings: { ...DEFAULT_ASPECT_RATIO_SETTINGS, strategy: 'crop', fx: 0, fy: 1 },
      targetWidth: 1000, targetHeight: 500, detect,
      render: async ({ file }) => {
        if (file.name === 'b.png') throw new Error('编码失败')
        return { blob: new Blob(['ok']), mimeType: 'image/jpeg', width: 1000, height: 500 }
      },
      update, shouldStop: () => false,
    })
    expect(images[0]).toMatchObject({ status: 'succeeded', cropFocus: { fx: 0, fy: 1, source: 'grid', note: gridCropNote(0, 1, true) } })
    expect(images[1].status).toBe('failed')
    expect(images[1].cropFocus).toBeUndefined()
  })

  it('留白填充和比例一致时不检测', async () => {
    let images = [item('letter'), item('same', 500, 500)]
    const update = (id: string, patch: Partial<BatchImage>) => {
      images = images.map(image => image.id === id ? { ...image, ...patch } : image)
    }
    const detect = vi.fn(async () => mockDetectSubject())
    await processBatch({
      images: [images[0]], settings: DEFAULT_ASPECT_RATIO_SETTINGS, targetWidth: 1000, targetHeight: 500,
      detect, render: async () => ({ blob: new Blob(['ok']), mimeType: 'image/jpeg', width: 1000, height: 500 }),
      update, shouldStop: () => false,
    })
    await processBatch({
      images: [images[1]], settings: { ...DEFAULT_ASPECT_RATIO_SETTINGS, strategy: 'crop' }, targetWidth: 500, targetHeight: 500,
      detect, render: async () => ({ blob: new Blob(['ok']), mimeType: 'image/jpeg', width: 500, height: 500 }),
      update, shouldStop: () => false,
    })
    expect(detect).not.toHaveBeenCalled()
    expect(images.every(image => image.cropFocus === undefined)).toBe(true)
  })

  it('检测图长边不超过 1280，进度文案带上正在处理的文件名', () => {
    expect(detectionPixelSize(800, 600)).toEqual({ width: 800, height: 600 })
    expect(detectionPixelSize(4000, 3000)).toEqual({ width: 1280, height: 960 })
    expect(detectionPixelSize(3000, 4000)).toEqual({ width: 960, height: 1280 })
    expect(cropProgressLabel(1, 6, ['香水.jpg', '纸杯.jpg', '耳机.jpg'])).toBe('正在识别商品主体，已完成 1 / 6，当前 香水.jpg、纸杯.jpg 等 3 张')
  })

  it('同时最多处理 3 张，单张失败不阻断其他图片', async () => {
    let images = [item('a'), item('b'), item('c'), item('d')]
    const update = (id: string, patch: Partial<BatchImage>) => {
      images = images.map(image => image.id === id ? { ...image, ...patch } : image)
    }
    let active = 0
    let peak = 0
    const detect = vi.fn(async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 30))
      active -= 1
      return mockDetectSubject()
    })
    await processBatch({
      images, settings: { ...DEFAULT_ASPECT_RATIO_SETTINGS, strategy: 'crop' },
      targetWidth: 1000, targetHeight: 500, detect, update, shouldStop: () => false,
      render: async ({ file }) => {
        if (file.name === 'b.png') throw new Error('编码失败')
        return { blob: new Blob(['ok']), mimeType: 'image/jpeg', width: 1000, height: 500 }
      },
    })
    expect(peak).toBe(CROP_CONCURRENCY)
    expect(images.map(image => image.status)).toEqual(['succeeded', 'failed', 'succeeded', 'succeeded'])
    expect(images[1].error).toBe('编码失败')
  })

  it('修改九宫格后清掉单图焦点和输出', () => {
    const cleared = invalidateBatch([{ ...item('a'), status: 'succeeded', output: new Blob(['old']), cropFocus: { fx: 0.5, fy: 0.05, source: 'subject', note: SUBJECT_CROP_NOTE } }])
    expect(cleared[0].cropFocus).toBeUndefined()
    expect(cleared[0].output).toBeUndefined()
    expect(cleared[0].status).toBe('pending')
  })
})
