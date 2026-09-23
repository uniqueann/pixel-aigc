import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inspectImage } from './validation'

function png(chunkName: string) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  const chunk = [0, 0, 0, 0, ...[...chunkName].map(char => char.charCodeAt(0)), 0, 0, 0, 0]
  return new File([new Uint8Array([...signature, ...chunk])], '图片.png', { type: 'image/png' })
}

function webp(animated: boolean) {
  const bytes = new Uint8Array(32)
  bytes.set([...`RIFF`].map(char => char.charCodeAt(0)), 0)
  bytes.set([...`WEBP`].map(char => char.charCodeAt(0)), 8)
  bytes.set([...`VP8X`].map(char => char.charCodeAt(0)), 12)
  bytes[20] = animated ? 2 : 0
  return new File([bytes], '图片.webp', { type: 'image/webp' })
}

describe('本地图片校验', () => {
  const close = vi.fn()
  beforeEach(() => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4000, height: 3000, close })))
  })
  afterEach(() => { vi.unstubAllGlobals(); close.mockReset() })

  it('静态 PNG 可进入队列，并释放解码位图', async () => {
    expect(await inspectImage(png('IDAT'))).toEqual({ width: 4000, height: 3000, mimeType: 'image/png' })
    expect(close).toHaveBeenCalledOnce()
  })

  it('拒绝 APNG 与动态 WebP，避免只处理首帧', async () => {
    await expect(inspectImage(png('acTL'))).rejects.toThrow('暂不支持动图')
    await expect(inspectImage(webp(true))).rejects.toThrow('暂不支持动图')
    expect(close).not.toHaveBeenCalled()
  })

  it('不信任扩展名，并拒绝超出像素上限的图片', async () => {
    const fake = new File([new Uint8Array([1, 2, 3])], '图片.png', { type: 'image/png' })
    await expect(inspectImage(fake)).rejects.toThrow('仅支持静态')
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 6000, height: 5000, close })))
    await expect(inspectImage(png('IDAT'))).rejects.toThrow('24 MP')
  })
})
