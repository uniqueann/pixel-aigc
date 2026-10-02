import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadTaskInput, validateImageFile } from './upload'

const mocks = vi.hoisted(() => ({ sign: vi.fn() }))
vi.mock('./client', () => ({ apiClient: { post: mocks.sign } }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); mocks.sign.mockReset() })
const png = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/jpeg' })

describe('uploadTaskInput', () => {
  it('真实格式纠正后原字节上传，阶段和成功字节可观测', async () => {
    mocks.sign.mockResolvedValue({ uploadUrl: 'https://r2.test/upload', objectKey: 'input-key' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
    const phases: string[] = []
    const metrics = vi.fn()
    expect(await uploadTaskInput(png, 'image/jpeg', undefined, { onPhase: phase => phases.push(phase), onMetrics: metrics })).toBe('input-key')
    expect(phases).toEqual(['validating', 'signing', 'uploading'])
    expect(mocks.sign).toHaveBeenCalledWith('/task-inputs', { mimeType: 'image/png', size: png.size })
    const init = vi.mocked(fetch).mock.calls[0][1]!
    expect(init.credentials).toBe('omit')
    expect(init.headers).toEqual({ 'Content-Type': 'image/png' })
    expect(new Uint8Array(await (init.body as Blob).arrayBuffer())).toEqual(new Uint8Array(await png.arrayBuffer()))
    expect(metrics).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'success', uploadedBytes: png.size }))
  })
  it('签名等待期间取消，迟到签名不能发起 PUT', async () => {
    let finish!: (value: unknown) => void
    mocks.sign.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    vi.stubGlobal('fetch', vi.fn())
    const controller = new AbortController()
    const result = uploadTaskInput(png, undefined, controller.signal).catch(error => error)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    controller.abort()
    finish({ uploadUrl: 'https://r2.test/upload', objectKey: 'input-key' })
    expect((await result).name).toBe('AbortError')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('空文件、非法格式及超大文件在申请签名前拒绝', async () => {
    await expect(uploadTaskInput(new Blob())).rejects.toThrow('不能为空')
    await expect(uploadTaskInput(new Blob(['损坏图片']))).rejects.toThrow('文件已损坏')
    await expect(uploadTaskInput(new Blob([new Uint8Array(21 * 1024 * 1024)]))).rejects.toThrow('不能超过')
    expect(mocks.sign).not.toHaveBeenCalled()
  })
})

describe('validateImageFile', () => {
  it('接受受支持的图片类型', () => {
    expect(() => validateImageFile({ type: 'image/png', size: 1024 })).not.toThrow()
  })

  it('拒绝不支持的格式和超大文件', () => {
    expect(() => validateImageFile({ type: 'image/gif', size: 1024 })).toThrow('仅支持 PNG、JPEG 和 WebP 图片')
    expect(() => validateImageFile({ type: 'image/jpeg', size: 21 * 1024 * 1024 })).toThrow('图片大小不能超过 20 MB')
  })
})
