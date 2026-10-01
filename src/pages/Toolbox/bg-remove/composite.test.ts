import { afterEach, describe, expect, it, vi } from 'vitest'
import { compositeMatte } from './composite'

afterEach(() => vi.unstubAllGlobals())
describe('透明 PNG 原尺寸下载', () => {
  it('直接复用透明 Blob，不创建全尺寸画布、不重复编码', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 3200, height: 5035, close })))
    const matte = new Blob(['png'], { type: 'image/png' })
    const result = await compositeMatte(matte, 'transparent')
    expect(result).toEqual({ blob: matte, mimeType: 'image/png', width: 3200, height: 5035 })
    expect(result.blob).toBe(matte)
    expect(close).toHaveBeenCalledTimes(1)
  })
})
