import { beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { send = send },
  GetObjectCommand: class { constructor(public input: unknown) {} },
  PutObjectCommand: class { constructor(public input: unknown) {} },
}))
import { getObject, getObjectLimited, verifyAndPromote } from './storage'
beforeEach(() => {
  send.mockReset()
  process.env.R2_ACCOUNT_ID = 'test'; process.env.R2_ACCESS_KEY_ID = 'test'; process.env.R2_SECRET_ACCESS_KEY = 'test'; process.env.R2_BUCKET = 'test'
})
function missing(name: string, status?: number) {
  return Object.assign(new Error('The specified key does not exist.'), {
    name,
    ...(status === undefined ? {} : { $metadata: { httpStatusCode: status } }),
  })
}

describe('R2 对象读取', () => {
  it('NoSuchKey、NotFound 和 HTTP 404 都视为对象不存在', async () => {
    send.mockRejectedValueOnce(missing('NoSuchKey', 404))
    await expect(getObject('temporary/openrouter-results/req/0.img')).rejects.toMatchObject({ status: 404, code: 'OBJECT_NOT_FOUND', message: '对象不存在' })
    send.mockRejectedValueOnce(missing('NotFound'))
    await expect(getObject('temporary/openrouter-results/req/0.img')).rejects.toMatchObject({ status: 404, code: 'OBJECT_NOT_FOUND' })
    send.mockRejectedValueOnce(Object.assign(new Error('missing'), { $metadata: { httpStatusCode: 404 } }))
    await expect(getObject('temporary/openrouter-results/req/0.img')).rejects.toMatchObject({ status: 404, code: 'OBJECT_NOT_FOUND' })
  })

  it('其他读取错误原样抛出', async () => {
    const denied = Object.assign(new Error('denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } })
    send.mockRejectedValue(denied)
    await expect(getObject('generated/u/job/0.png')).rejects.toBe(denied)
  })

  it('读到对象时返回字节', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    send.mockResolvedValue({ Body: { transformToByteArray: async () => bytes }, ContentType: 'image/png' })
    await expect(getObject('generated/u/job/0.png')).resolves.toEqual({ bytes, contentType: 'image/png' })
  })
})

describe('R2 对象核验', () => {
  it('临时输入已过期返回可重传的错误码', async () => {
    send.mockRejectedValueOnce(missing('NoSuchKey'))
    await expect(getObjectLimited('temporary/task-inputs/u/old', 20 * 1024 * 1024)).rejects.toMatchObject({ status: 404, code: 'OBJECT_NOT_FOUND' })
    send.mockRejectedValueOnce(missing('NotFound', 404))
    await expect(getObjectLimited('temporary/task-inputs/u/old', 20 * 1024 * 1024)).rejects.toMatchObject({ status: 404, code: 'OBJECT_NOT_FOUND', message: '图片对象已过期或不存在，请重新上传' })
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
