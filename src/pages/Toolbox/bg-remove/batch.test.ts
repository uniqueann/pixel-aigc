import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { imagesNeedingRemoval, processRemovalBatch, recompositeBatch } from './batch'
import { outputNames } from './download'
import { normalizeSettings, outputMime, readPrefs, writePrefs } from './prefs'
import { DEFAULT_BG_REMOVE_SETTINGS, type BatchImage } from './types'

function item(id: string, status: BatchImage['status'] = 'pending', matte?: Blob): BatchImage {
  return {
    id, file: new File(['source'], `${id}.png`, { type: 'image/png' }), sourceMime: 'image/png',
    sourceUrl: '', width: 20, height: 10, status, matte,
  }
}

describe('抠图背景设置', () => {
  it('默认白底，非法颜色回退，并按用户记住选择', async () => {
    expect(normalizeSettings({ background: 'red' })).toEqual(DEFAULT_BG_REMOVE_SETTINGS)
    expect(outputMime('transparent')).toBe('image/png')
    expect(outputMime('#112233')).toBe('image/jpeg')
    await writePrefs('user-a', { background: 'transparent' })
    expect(await readPrefs('user-a')).toEqual({ background: 'transparent' })
    expect(await readPrefs('user-b')).toEqual(DEFAULT_BG_REMOVE_SETTINGS)
  })
})

describe('抠图批量', () => {
  it('已有透明结果不再请求抠图，失败不阻断其他图片', async () => {
    let images = [item('a', 'succeeded', new Blob(['matte'])), item('b'), item('c')]
    const update = (id: string, patch: Partial<BatchImage>) => {
      images = images.map(image => image.id === id ? { ...image, ...patch } : image)
    }
    const remove = vi.fn(async (image: BatchImage) => {
      if (image.id === 'b') throw new Error('抠图失败')
      return new Blob(['new-matte'], { type: 'image/png' })
    })
    await processRemovalBatch({
      images, remove, update, shouldStop: () => false, concurrency: 2,
      compose: async () => ({ blob: new Blob(['jpg'], { type: 'image/jpeg' }), mimeType: 'image/jpeg' }),
    })
    expect(remove).toHaveBeenCalledTimes(2)
    expect(images.find(image => image.id === 'a')?.matte?.size).toBe(5)
    expect(images.find(image => image.id === 'b')?.status).toBe('failed')
    expect(images.find(image => image.id === 'c')?.status).toBe('succeeded')
  })

  it('换背景只重合成，不增加抠图次数', async () => {
    let images = [item('a', 'succeeded', new Blob(['matte']))]
    const update = (id: string, patch: Partial<BatchImage>) => {
      images = images.map(image => image.id === id ? { ...image, ...patch } : image)
    }
    const compose = vi.fn(async () => ({ blob: new Blob(['png'], { type: 'image/png' }), mimeType: 'image/png' }))
    await recompositeBatch(images, compose, update)
    expect(compose).toHaveBeenCalledOnce()
    expect(imagesNeedingRemoval(images)).toEqual([])
    expect(images[0].outputMime).toBe('image/png')
  })
})

describe('抠图下载名', () => {
  it('按结果格式去重', () => {
    expect(outputNames([
      { name: '商品.jpg', mimeType: 'image/jpeg' },
      { name: '商品.png', mimeType: 'image/png' },
    ])).toEqual(['商品_cutout.jpg', '商品_cutout.png'])
  })
})
