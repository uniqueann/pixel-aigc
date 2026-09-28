import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { cropRect, cropToSourceAspect } from './aspect-crop.js'

describe('cropToSourceAspect', () => {
  it('按原图比例居中裁切更宽的输出', async () => {
    expect(cropRect(200, 100, 1)).toEqual({ left: 50, top: 0, width: 100, height: 100, cropped: true })
    const source = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#f00' } }).png().toBuffer()
    const cropped = await cropToSourceAspect(source, 100, 100)
    expect(cropped).toMatchObject({ width: 100, height: 100, mimeType: 'image/png', cropped: true })
    const meta = await sharp(cropped.bytes).metadata()
    expect(meta).toMatchObject({ width: 100, height: 100 })
  })

  it('比例已经接近时不裁切', async () => {
    const source = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#0f0' } }).png().toBuffer()
    const result = await cropToSourceAspect(source, 1200, 800)
    expect(result.cropped).toBe(false)
    expect(result).toMatchObject({ width: 120, height: 80 })
  })

  it('输出更高时裁切上下', () => {
    expect(cropRect(100, 200, 1)).toEqual({ left: 0, top: 50, width: 100, height: 100, cropped: true })
  })
})
