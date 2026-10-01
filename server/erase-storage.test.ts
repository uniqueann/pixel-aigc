import { beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'

const getObjectLimited = vi.fn()
vi.mock('./storage', () => ({ getObjectLimited: (...args: unknown[]) => getObjectLimited(...args) }))

import { loadEraseStoredImage, loadStoredSyncImage, validateSyncImage } from './erase-storage'

beforeEach(() => getObjectLimited.mockReset())

describe('消除对象输入校验', () => {
  it('拒绝其他用户的对象键，且不读取 R2', async () => {
    await expect(loadEraseStoredImage('owner', 'generated/other/job/0.png', 'source')).rejects.toThrow('无权访问')
    expect(getObjectLimited).not.toHaveBeenCalled()
  })

  it('校验真实图片格式和尺寸后返回原字节', async () => {
    const bytes = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#fff' } }).jpeg().toBuffer()
    getObjectLimited.mockResolvedValue({ bytes, contentType: 'image/jpeg' })
    const result = await loadEraseStoredImage('owner', 'temporary/task-inputs/owner/source', 'source')
    expect(result).toEqual({ bytes, width: 12, height: 8, mimeType: 'image/jpeg' })
    expect(getObjectLimited).toHaveBeenCalledWith('temporary/task-inputs/owner/source', 20 * 1024 * 1024)
  })

  it('拒绝声明为 PNG 的 JPEG 蒙版', async () => {
    const bytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#fff' } }).jpeg().toBuffer()
    getObjectLimited.mockResolvedValue({ bytes, contentType: 'image/png' })
    await expect(loadEraseStoredImage('owner', 'temporary/task-inputs/owner/mask', 'mask')).rejects.toThrow('格式或尺寸无效')
  })

  it('旧 R2 原图即使标成 PNG 或缺少类型，也返回实际 JPEG', async () => {
    const bytes = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#fff' } }).jpeg().toBuffer()
    for (const contentType of ['image/png', undefined]) {
      getObjectLimited.mockResolvedValue({ bytes, contentType })
      const onRead = vi.fn(), onValidate = vi.fn()
      const result = await loadStoredSyncImage('owner', 'temporary/task-inputs/owner/old.png', 'source', undefined, { onRead, onValidate })
      expect(result).toMatchObject({ bytes, mimeType: 'image/jpeg' })
      expect(onRead).toHaveBeenCalledWith(bytes.length, expect.any(Number))
      expect(onValidate).toHaveBeenCalledWith(expect.objectContaining({ actualMime: 'image/jpeg', valid: true }))
    }
  })

  it('损坏图片在模型调用前拒绝，并保留已读取的字节和校验耗时', async () => {
    const bytes = Buffer.from([255, 216, 255, 224, 0, 16])
    getObjectLimited.mockResolvedValue({ bytes, contentType: 'image/jpeg' })
    const onRead = vi.fn(), onValidate = vi.fn()
    await expect(loadStoredSyncImage('owner', 'temporary/task-inputs/owner/broken', 'source', undefined, { onRead, onValidate })).rejects.toThrow('损坏')
    expect(onRead).toHaveBeenCalledWith(bytes.length, expect.any(Number))
    expect(onValidate).toHaveBeenCalledWith(expect.objectContaining({ stage: 'imageValidate', valid: false }))
  })

  it('扩图专属上限允许复用超过 4000 万像素的结果，其他工具仍拒绝', async () => {
    const bytes = await sharp({ create: { width: 8000, height: 5001, channels: 3, background: '#fff' } }).jpeg().toBuffer()
    await expect(validateSyncImage(bytes, 'source', 'image/png')).rejects.toThrow('40 百万像素')
    await expect(validateSyncImage(bytes, 'source', 'image/png', 64_000_000)).resolves.toMatchObject({ width: 8000, height: 5001, mimeType: 'image/jpeg' })
  })

  it('超过 6400 万像素的声明尺寸在解码前拒绝', async () => {
    const bytes = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#fff' } }).jpeg().toBuffer()
    const marker = bytes.indexOf(Buffer.from([255, 192]))
    expect(marker).toBeGreaterThan(0)
    bytes.writeUInt16BE(8000, marker + 5)
    bytes.writeUInt16BE(9000, marker + 7)
    await expect(validateSyncImage(bytes, 'source', 'image/jpeg', 64_000_000)).rejects.toThrow('64 百万像素')
  })

  it('有效文件头之后的截断数据不能通过完整解码', async () => {
    const bytes = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#fff' } }).jpeg().toBuffer()
    await expect(validateSyncImage(bytes.subarray(0, bytes.length - 200), 'source', 'image/jpeg')).rejects.toThrow('损坏')
  })

  it('蒙版只能使用本人临时上传的对象', async () => {
    await expect(loadEraseStoredImage('owner', 'generated/owner/job/0.png', 'mask')).rejects.toThrow('无权访问')
    expect(getObjectLimited).not.toHaveBeenCalled()
  })
})
