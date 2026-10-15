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
  it('直传 R2 失败时自动降级通过后端 fallback 上传', async () => {
    mocks.sign.mockResolvedValueOnce({ uploadUrl: 'https://r2.test/upload', objectKey: 'input-key' })
    mocks.sign.mockResolvedValueOnce({ ok: true })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    expect(await uploadTaskInput(png, 'image/jpeg')).toBe('input-key')
    expect(mocks.sign).toHaveBeenNthCalledWith(2, '/task-inputs/fallback', expect.objectContaining({
      objectKey: 'input-key', mimeType: 'image/png', dataBase64: expect.any(String),
    }))
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
  it('直传失败后累计两次传输耗时，分别记录回退阶段', async () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    mocks.sign.mockImplementation(async (path: string) => {
      now += path === '/task-inputs' ? 5 : 60
      return path === '/task-inputs' ? { uploadUrl: 'https://r2.test/upload', objectKey: 'input-key' } : { ok: true }
    })
    vi.stubGlobal('fetch', vi.fn(async () => { now += 40; throw new TypeError('网络中断') }))
    const metrics = vi.fn()
    await uploadTaskInput(png, undefined, undefined, { onMetrics: metrics })
    expect(metrics).toHaveBeenCalledWith(expect.objectContaining({
      signMs: 5, directUploadMs: 40, directOutcome: 'network-error', fallbackUploadMs: 60,
      fallbackEncodeMs: 0, uploadMs: 100, elapsedMs: 105, transport: 'fallback', outcome: 'success',
    }))
  })
  it('直传 HTTP 失败有明确状态，保持原有不自动回退行为', async () => {
    mocks.sign.mockResolvedValue({ uploadUrl: 'https://r2.test/upload', objectKey: 'input-key' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })))
    const metrics = vi.fn()
    await expect(uploadTaskInput(png, undefined, undefined, { onMetrics: metrics })).rejects.toThrow('原图上传失败')
    expect(mocks.sign).toHaveBeenCalledTimes(1)
    expect(metrics).toHaveBeenCalledWith(expect.objectContaining({ directStatus: 503, directOutcome: 'http-error', outcome: 'failed' }))
  })
  it('跨域时序不可见时不将零值解释为 DNS 或建连实际耗时', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(100)
    vi.spyOn(performance, 'getEntriesByName').mockReturnValue([
      { startTime: 100, requestStart: 0, responseStart: 0 } as PerformanceResourceTiming,
    ])
    mocks.sign.mockResolvedValue({ uploadUrl: 'https://r2.test/upload', objectKey: 'input-key' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
    const metrics = vi.fn()
    await uploadTaskInput(png, undefined, undefined, { onMetrics: metrics })
    expect(metrics.mock.calls[0][0].networkTiming).toBeUndefined()
  })
  it('可见的网络时序仅记录数值，不泄漏上传签名和对象地址', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(100)
    vi.spyOn(performance, 'getEntriesByName').mockReturnValue([
      { startTime: 100, domainLookupStart: 100, domainLookupEnd: 103, connectStart: 103, secureConnectionStart: 105,
        connectEnd: 110, requestStart: 110, responseStart: 125, responseEnd: 126 } as PerformanceResourceTiming,
    ])
    mocks.sign.mockResolvedValue({ uploadUrl: 'https://r2.test/private?signature=secret', objectKey: 'input-key' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
    const metrics = vi.fn()
    await uploadTaskInput(png, undefined, undefined, { onMetrics: metrics })
    expect(metrics.mock.calls[0][0].networkTiming).toEqual({ dnsMs: 3, connectMs: 7, tlsMs: 5, requestToResponseMs: 15, responseReadMs: 1 })
    expect(JSON.stringify(metrics.mock.calls)).not.toMatch(/signature|secret|r2\.test|input-key/)
  })
  it('网络观测接口异常不会使已成功的上传失败', async () => {
    vi.spyOn(performance, 'getEntriesByName').mockImplementation(() => { throw new Error('观测受限') })
    mocks.sign.mockResolvedValue({ uploadUrl: 'https://r2.test/upload', objectKey: 'input-key' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
    await expect(uploadTaskInput(png)).resolves.toBe('input-key')
  })
  it('直传期间取消不会触发回退上传', async () => {
    const abort = new AbortController()
    mocks.sign.mockResolvedValue({ uploadUrl: 'https://r2.test/upload', objectKey: 'input-key' })
    vi.stubGlobal('fetch', vi.fn(async () => { abort.abort(); throw new DOMException('取消', 'AbortError') }))
    const metrics = vi.fn()
    await expect(uploadTaskInput(png, undefined, abort.signal, { onMetrics: metrics })).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.sign).toHaveBeenCalledTimes(1)
    expect(metrics).toHaveBeenCalledWith(expect.objectContaining({ directOutcome: 'cancelled', outcome: 'cancelled' }))
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
