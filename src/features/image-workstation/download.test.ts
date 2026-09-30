import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchOwnedObject = vi.fn()
vi.mock('@/services/api/objects', () => ({
  fetchOwnedObject: (...args: unknown[]) => fetchOwnedObject(...args),
}))

import {
  blobFromImageSource,
  downloadFailureMessage,
  extensionForMime,
  filenameForWorkstationResult,
  filenameWithMimeExtension,
} from './download'

describe('工作站结果下载命名', () => {
  it('用工具名和真实像素尺寸命名，避免覆盖', () => {
    expect(filenameForWorkstationResult({
      toolLabel: '重绘',
      width: 1280,
      height: 1280,
      mimeType: 'image/jpeg',
    })).toBe('重绘_1280x1280.jpg')
    expect(filenameForWorkstationResult({
      toolLabel: '消除',
      width: 1600,
      height: 1200,
      mimeType: 'image/png',
      index: 2,
    })).toBe('消除_1600x1200_2.png')
  })

  it('从 MIME 推断扩展名', () => {
    expect(extensionForMime('image/webp')).toBe('webp')
    expect(extensionForMime('image/jpeg')).toBe('jpg')
    expect(extensionForMime()).toBe('jpg')
    expect(filenameWithMimeExtension('mug.jpg', 'image/png')).toBe('mug.png')
    expect(filenameWithMimeExtension('mug', 'image/webp')).toBe('mug.webp')
  })
})

describe('读取结果图片', () => {
  beforeEach(() => {
    fetchOwnedObject.mockReset()
  })

  it('有对象 key 时走同域 /api/objects，不直接 fetch 签名 URL', async () => {
    const blob = new Blob(['png'], { type: 'image/png' })
    fetchOwnedObject.mockResolvedValue(blob)
    await expect(blobFromImageSource('https://r2.example/generated/a.png?X-Amz-Signature=x', 'generated/user/job/0.png'))
      .resolves.toBe(blob)
    expect(fetchOwnedObject).toHaveBeenCalledWith('generated/user/job/0.png')
  })

  it('blob / data / 相对地址仍可直接读取', async () => {
    const blob = new Blob(['local'], { type: 'image/jpeg' })
    await expect(blobFromImageSource(blob)).resolves.toBe(blob)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['ok'], { type: 'image/png' }), { status: 200 })))
    await expect(blobFromImageSource('data:image/png;base64,xx')).resolves.toBeInstanceOf(Blob)
    await expect(blobFromImageSource('result.png')).resolves.toBeInstanceOf(Blob)
    vi.unstubAllGlobals()
  })

  it('远程签名 URL 没有对象 key 时直接拒绝，避免浏览器 CORS 静默失败', async () => {
    await expect(blobFromImageSource('https://r2.example/generated/a.png?X-Amz-Signature=x'))
      .rejects.toThrow('读取图片失败')
  })

  it('下载失败文案不会是空的 Failed to fetch', () => {
    expect(downloadFailureMessage(new TypeError('Failed to fetch'))).toBe('下载失败：无法读取结果图片')
    expect(downloadFailureMessage(new Error(''))).toBe('下载失败：无法读取结果图片')
    expect(downloadFailureMessage(new Error('对象无效或无权访问'))).toBe('下载失败：对象无效或无权访问')
  })
})
