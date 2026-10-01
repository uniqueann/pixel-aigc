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
  it('旧 JPEG 结果标成 PNG 时，ZIP 内文件扩展名依据实际字节纠正', async () => {
    const bytes = new Uint8Array([255, 216, 255, 224, 0, 16])
    const zip = await createAspectRatioZip([image('旧结果.png', new Blob([bytes], { type: 'image/png' }), 'old')], 'amazon-main')
    const reader = new ZipReader(new BlobReader(zip))
    const entries = await reader.getEntries()
    expect(entries[0].filename).toBe('旧结果_amazon-main.jpg')
    if (!('getData' in entries[0])) throw new Error('结果不是图片文件')
    expect(new Uint8Array(await (await entries[0].getData(new BlobWriter())).arrayBuffer())).toEqual(bytes)
    await reader.close()
  })

  it('ZIP 使用平台后缀且不冲突', async () => {
    const items = [
      image('商品.jpg', new Blob([new Uint8Array([255, 216, 255]), '第一张'], { type: 'image/jpeg' }), 'one'),
      image('商品.png', new Blob([new Uint8Array([255, 216, 255]), '第二张'], { type: 'image/jpeg' }), 'two'),
    ]
    expect([...namesForImages(items, 'amazon-main').values()]).toEqual(['商品_amazon-main.jpg', '商品_amazon-main_2.jpg'])
    expect([...namesForImages([
      image('mug.jpg', new Blob(['png'], { type: 'image/png' }), 'png-out'),
    ], 'amazon-main').values()]).toEqual(['mug_amazon-main.png'])
    const zip = await createAspectRatioZip(items, 'amazon-main')
    const reader = new ZipReader(new BlobReader(zip))
    const entries = await reader.getEntries()
    expect(entries.map(entry => entry.filename)).toEqual(['商品_amazon-main.jpg', '商品_amazon-main_2.jpg'])
    const second = entries[1]
    if (!('getData' in second)) throw new Error('第二项不是图片文件')
    expect(new Uint8Array(await (await second.getData(new BlobWriter())).arrayBuffer())).toEqual(new Uint8Array(await items[1].output!.arrayBuffer()))
    await reader.close()
  })
})
