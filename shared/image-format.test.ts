import { describe, expect, it } from 'vitest'
import { detectImageMime, normalizeImageBlob } from './image-format'

const jpeg = new Uint8Array([255, 216, 255, 224, 0, 16])
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const webp = new TextEncoder().encode('RIFF0000WEBPVP8 ')

describe('图片实际格式', () => {
  it('识别 JPEG、PNG、WebP，并拒绝未知格式', () => {
    expect(detectImageMime(jpeg)).toBe('image/jpeg')
    expect(detectImageMime(png)).toBe('image/png')
    expect(detectImageMime(webp)).toBe('image/webp')
    expect(detectImageMime(new TextEncoder().encode('GIF89a'))).toBeUndefined()
  })
  it('纠正错误 MIME，但保留全部字节及正常对象引用', async () => {
    const wrong = new Blob([jpeg], { type: 'image/png' })
    const normalized = await normalizeImageBlob(wrong)
    expect(normalized.type).toBe('image/jpeg')
    expect(new Uint8Array(await normalized.arrayBuffer())).toEqual(jpeg)
    expect(await normalizeImageBlob(normalized)).toBe(normalized)
    await expect(normalizeImageBlob(new Blob(['伪图片'], { type: 'image/jpeg' }))).rejects.toThrow('损坏')
  })
})
