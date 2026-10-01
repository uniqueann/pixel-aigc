import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ put: vi.fn(), sign: vi.fn(), provider: vi.fn() }))
vi.mock('./storage', () => ({ putObject: mocks.put, signRead: mocks.sign }))
vi.mock('./tencent-matting', () => ({ mattingFromUrl: mocks.provider }))
import { removeBackground } from './bg-remove'

beforeEach(() => {
  mocks.put.mockReset()
  mocks.sign.mockReset().mockResolvedValue({ url: 'https://r2.test/signed?secret=test' })
  mocks.provider.mockReset()
})

describe('抠图 R2 送模与蒙版恢复链路', () => {
  it('合规对象输入直接签名，不经 Vercel 再次上传原图', async () => {
    const image = await sharp({ create: { width: 64, height: 40, channels: 3, background: '#aa2211' } }).jpeg().toBuffer()
    const png = await sharp({ create: { width: 64, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer()
    mocks.provider.mockResolvedValue(png)
    const log = vi.fn()
    const result = await removeBackground(image, { userId: 'u', requestId: 'r', sourceImageKey: 'temporary/task-inputs/u/image', deadlineAt: Date.now() + 5000, log })
    expect(mocks.put).not.toHaveBeenCalled()
    expect(mocks.sign).toHaveBeenCalledWith('temporary/task-inputs/u/image', 3600)
    expect(mocks.provider).toHaveBeenCalledWith('https://r2.test/signed?secret=test', expect.any(Object))
    const pixel = await sharp(result).raw().toBuffer()
    expect(pixel[0]).toBeGreaterThan(160)
    expect(pixel[3]).toBeGreaterThan(120)
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret')
  })
  it('WebP 输入生成 JPEG 识别副本，结果恢复原图尺寸', async () => {
    const image = await sharp({ create: { width: 64, height: 40, channels: 3, background: '#112233' } }).webp().toBuffer()
    mocks.provider.mockResolvedValue(await sharp({ create: { width: 64, height: 40, channels: 4, background: '#ffffff' } }).png().toBuffer())
    const result = await removeBackground(image, { userId: 'u', requestId: 'r', sourceImageKey: 'temporary/task-inputs/u/image', deadlineAt: Date.now() + 5000, log: vi.fn() })
    expect(mocks.put).toHaveBeenCalledWith('temporary/tencent-inputs/bg-remove/u/r.jpg', expect.any(Buffer), 'image/jpeg', expect.any(AbortSignal))
    expect(await sharp(result).metadata()).toMatchObject({ width: 64, height: 40, hasAlpha: true })
  })
  it('超高竖图上传直立工作副本，腾讯只调用一次并记录朝向与缩放比例', async () => {
    const image = await sharp({ create: { width: 320, height: 5035, channels: 3, background: '#aa2211' } }).jpeg().toBuffer()
    mocks.provider.mockImplementation(async () => {
      const uploaded = mocks.put.mock.calls[0][1] as Buffer
      const metadata = await sharp(uploaded).metadata()
      expect(metadata).toMatchObject({ width: 275, height: 4320 })
      return sharp({ create: { width: metadata.width!, height: metadata.height!, channels: 4, background: '#ffffff' } }).png().toBuffer()
    })
    const log = vi.fn()
    const result = await removeBackground(image, { userId: 'u', requestId: 'r', sourceImageKey: 'temporary/task-inputs/u/portrait', deadlineAt: Date.now() + 5000, log })
    expect(mocks.sign).toHaveBeenCalledWith('temporary/tencent-inputs/bg-remove/u/r.jpg', 3600)
    expect(mocks.provider).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ stage: 'inputPrepare', orientationPolicy: 'upright',
      contentWidth: 275, contentHeight: 4320, scaleX: 275 / 320, scaleY: 4320 / 5035, reusableSource: false }))
    expect(await sharp(result).metadata()).toMatchObject({ width: 320, height: 5035, hasAlpha: true })
  })
  it('副本写入失败不调用腾讯', async () => {
    mocks.put.mockRejectedValue(new Error('network'))
    const image = await sharp({ create: { width: 64, height: 40, channels: 4, background: '#fff' } }).png().toBuffer()
    await expect(removeBackground(image, { userId: 'u', requestId: 'r', deadlineAt: Date.now() + 5000, log: vi.fn() })).rejects.toMatchObject({ code: 'BG_REMOVE_INPUT_WRITE_FAILED' })
    expect(mocks.provider).not.toHaveBeenCalled()
  })
})
