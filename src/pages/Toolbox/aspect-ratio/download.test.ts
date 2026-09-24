import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js'
import { describe, expect, it } from 'vitest'
import { createAspectRatioZip, namesForImages } from './download'
import type { BatchImage } from './types'

function image(name: string, output: Blob, id: string): BatchImage {
  return {
    id, file: new File(['source'], name, { type: 'image/jpeg' }), sourceMime: 'image/jpeg',
    sourceUrl: '', width: 100, height: 100, status: 'succeeded', output, outputMime: output.type,
  }
}

describe('转比例下载', () => {
  it('ZIP 使用平台后缀且不冲突', async () => {
    const items = [
      image('商品.jpg', new Blob(['第一张'], { type: 'image/jpeg' }), 'one'),
      image('商品.png', new Blob(['第二张'], { type: 'image/jpeg' }), 'two'),
    ]
    expect([...namesForImages(items, 'amazon-main').values()]).toEqual(['商品_amazon-main.jpg', '商品_amazon-main_2.jpg'])
    const zip = await createAspectRatioZip(items, 'amazon-main')
    const reader = new ZipReader(new BlobReader(zip))
    const entries = await reader.getEntries()
    expect(entries.map(entry => entry.filename)).toEqual(['商品_amazon-main.jpg', '商品_amazon-main_2.jpg'])
    const second = entries[1]
    if (!('getData' in second)) throw new Error('第二项不是图片文件')
    expect(await (await second.getData(new BlobWriter())).text()).toBe('第二张')
    await reader.close()
  })
})
