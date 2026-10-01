import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('./client', () => ({ apiClient: { post: mocks.post } }))
import { uploadTaskInput } from './upload'

beforeEach(() => {
  mocks.post.mockResolvedValue({ uploadUrl: 'https://r2.test/upload', objectKey: 'temporary/task-inputs/owner/image' })
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })))
})

describe('上传真实格式', () => {
  it('JPEG 旧文件的签名、PUT 头和字节一致，不重编码', async () => {
    const bytes = new Uint8Array([255, 216, 255, 224, 0, 16])
    const file = new File([bytes], '错误文件名.png', { type: 'image/png' })
    await uploadTaskInput(file, 'image/png')
    expect(mocks.post).toHaveBeenCalledWith('/task-inputs', { mimeType: 'image/jpeg', size: bytes.length })
    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(init?.headers).toEqual({ 'Content-Type': 'image/jpeg' })
    expect(new Uint8Array(await (init?.body as Blob).arrayBuffer())).toEqual(bytes)
  })
  it('未知图片不请求签名、不上传', async () => {
    mocks.post.mockClear()
    await expect(uploadTaskInput(new Blob(['假图片'], { type: 'image/png' }))).rejects.toThrow('损坏')
    expect(mocks.post).not.toHaveBeenCalled()
  })
})
