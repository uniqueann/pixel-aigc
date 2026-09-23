import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js'
import { describe, expect, it } from 'vitest'
import { createWatermarkZip, namesForImages } from './download'
import type { BatchImage } from './types'

function image(name: string, mimeType: BatchImage['sourceMime'], output: Blob, id: string): BatchImage {
  return {
    id,
    file: new File(['source'], name, { type: mimeType }),
    sourceMime: mimeType,
    sourceUrl: '',
    width: 100,
    height: 100,
    status: 'succeeded',
    output,
    outputMime: output.type,
  }
}

describe('批量结果下载', () => {
  it('生成可解压 ZIP，名称与真实格式一致且不冲突', async () => {
    const items = [
      image('商品.jpg', 'image/jpeg', new Blob(['第一张'], { type: 'image/jpeg' }), 'one'),
      image('商品.png', 'image/png', new Blob(['第二张'], { type: 'image/jpeg' }), 'two'),
    ]
    expect([...namesForImages(items).values()]).toEqual(['商品_watermarked.jpg', '商品_watermarked_2.jpg'])
    const zip = await createWatermarkZip(items)
    const reader = new ZipReader(new BlobReader(zip))
    const entries = await reader.getEntries()
    expect(entries.map(entry => entry.filename)).toEqual(['商品_watermarked.jpg', '商品_watermarked_2.jpg'])
    const second = entries[1]
    if (!('getData' in second)) throw new Error('第二项不是图片文件')
    const blob = await second.getData(new BlobWriter())
    expect(await blob.text()).toBe('第二张')
    await reader.close()
  })
})
