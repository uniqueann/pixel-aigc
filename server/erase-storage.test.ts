import { beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'

const getObjectLimited = vi.fn()
vi.mock('./storage', () => ({ getObjectLimited: (...args: unknown[]) => getObjectLimited(...args) }))

import { loadEraseStoredImage } from './erase-storage'

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
    expect(result).toEqual({ bytes, width: 12, height: 8 })
    expect(getObjectLimited).toHaveBeenCalledWith('temporary/task-inputs/owner/source', 20 * 1024 * 1024)
  })

  it('拒绝声明为 PNG 的 JPEG 蒙版', async () => {
    const bytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#fff' } }).jpeg().toBuffer()
    getObjectLimited.mockResolvedValue({ bytes, contentType: 'image/png' })
    await expect(loadEraseStoredImage('owner', 'temporary/task-inputs/owner/mask', 'mask')).rejects.toThrow('格式或尺寸无效')
  })

  it('蒙版只能使用本人临时上传的对象', async () => {
    await expect(loadEraseStoredImage('owner', 'generated/owner/job/0.png', 'mask')).rejects.toThrow('无权访问')
    expect(getObjectLimited).not.toHaveBeenCalled()
  })
})
