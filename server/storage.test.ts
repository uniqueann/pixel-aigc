import { beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { send = send },
  GetObjectCommand: class { constructor(public input: unknown) {} },
  PutObjectCommand: class { constructor(public input: unknown) {} },
}))
import { getObjectLimited, verifyAndPromote } from './storage'
beforeEach(() => {
  send.mockReset()
  process.env.R2_ACCOUNT_ID = 'test'; process.env.R2_ACCESS_KEY_ID = 'test'; process.env.R2_SECRET_ACCESS_KEY = 'test'; process.env.R2_BUCKET = 'test'
})
describe('R2 对象核验', () => {
  it('临时输入已过期返回可重传的错误码', async () => {
    send.mockRejectedValue(Object.assign(new Error('不存在'), { name: 'NoSuchKey' }))
    await expect(getObjectLimited('temporary/task-inputs/u/old', 20 * 1024 * 1024)).rejects.toMatchObject({ status: 404, code: 'OBJECT_NOT_FOUND' })
  })
  it('保存同一份已验证字节，重复核验仍可使用临时对象', async () => {
    const png = await sharp({ create: { width: 3, height: 2, channels: 4, background: '#fff' } }).png().toBuffer()
    send.mockResolvedValueOnce({ ContentLength: png.length, Body: { transformToByteArray: async () => png } }).mockResolvedValueOnce({})
    expect(await verifyAndPromote('temporary/a','media/a',png.length,'image/png')).toEqual({ width: 3, height: 2 })
    expect(send.mock.calls[1][0].input.Body).toBe(png)
    expect(send).toHaveBeenCalledTimes(2)
  })
  it('拒绝实际长度不符，且不写正式对象', async () => {
    send.mockResolvedValueOnce({ ContentLength: 100, Body: {} })
    await expect(verifyAndPromote('temp','final',200,'image/png')).rejects.toThrow('大小不匹配')
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('拒绝扩展名或声明类型伪装', async () => {
    const png = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#fff' } }).png().toBuffer()
    send.mockResolvedValueOnce({ ContentLength: png.length, Body: { transformToByteArray: async () => png } })
    await expect(verifyAndPromote('temp','final',png.length,'image/jpeg')).rejects.toThrow('类型不匹配')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('对象读取过程中超过上限时停止缓冲', async () => {
    const body = {
      async *[Symbol.asyncIterator]() {
        yield Buffer.alloc(5)
        yield Buffer.alloc(5)
      },
    }
    send.mockResolvedValue({ ContentLength: 8, ContentType: 'image/png', Body: body })
    await expect(getObjectLimited('temporary/task-inputs/u/large', 8)).rejects.toThrow('20 MB')
  })
})
