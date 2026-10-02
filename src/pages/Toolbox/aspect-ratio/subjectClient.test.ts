// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { detectImageSubject } from './subjectClient'
import { SubjectDetectionCache } from './subjectCache'
const mocks = vi.hoisted(() => ({ bitmap: vi.fn(), fetch: vi.fn() }))
vi.mock('@/services/api/task', () => ({ liveCapabilityReady: () => false }))
vi.mock('@/services/api/image-transfer', async original => ({
  ...await original<typeof import('@/services/api/image-transfer')>(),
  imageAuthHeader: async () => ({ Authorization: 'Bearer 测试令牌' }),
}))
const input = () => ({ file: new File(['图片'], '大图.png', { type: 'image/png' }), width: 3200, height: 5035 })
const box = { x: 0.1, y: 0.2, width: 0.5, height: 0.4 }
describe('主体检测实际客户端链路', () => {
  beforeEach(() => {
    mocks.bitmap.mockReset().mockResolvedValue({ close: vi.fn() })
    mocks.fetch.mockReset().mockResolvedValue(new Response(JSON.stringify({ box, requestId: 'test-id' })))
    vi.stubGlobal('createImageBitmap', mocks.bitmap); vi.stubGlobal('fetch', mocks.fetch)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['JPEG'], { type: 'image/jpeg' })))
    vi.spyOn(console, 'debug').mockImplementation(() => undefined)
  })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
  it('同图第二次跳过解码、编码和 POST，首次保留方向与 1280 工作尺寸并记录实际 JSON 字节', async () => {
    const cache = new SubjectDetectionCache('owner'); const image = input()
    await cache.read(image); await cache.read(image)
    expect(mocks.bitmap).toHaveBeenCalledTimes(1)
    expect(mocks.bitmap).toHaveBeenCalledWith(image.file, expect.objectContaining({ imageOrientation: 'from-image', resizeHeight: 1280 }))
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledTimes(1)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    const init = mocks.fetch.mock.calls[0][1]
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ mimeType: 'image/jpeg', width: 814, height: 1280, clientTimingMs: { decode: expect.any(Number), encode: expect.any(Number), base64: expect.any(Number) } })
    expect(console.debug).toHaveBeenCalledWith('[主体检测]', expect.objectContaining({ requestCount: 1, requestBytes: new TextEncoder().encode(init.body).byteLength, requestId: 'test-id', outcome: 'success' }))
    expect(JSON.stringify(vi.mocked(console.debug).mock.calls)).not.toMatch(/测试令牌|dataBase64|JPEG|大图/)
  })
  it('本地解码途中取消，迟到 Bitmap 释放且不继续 POST', async () => {
    let resolve!: (value: { close: () => void }) => void
    mocks.bitmap.mockImplementation(() => new Promise(done => { resolve = done }))
    const controller = new AbortController(); const close = vi.fn()
    const promise = detectImageSubject(input(), { signal: controller.signal }).catch(error => error)
    controller.abort()
    resolve({ close })
    expect((await promise).name).toBe('AbortError')
    expect(close).toHaveBeenCalledTimes(1)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it.each([undefined, { x: -1, y: 0, width: 0.5, height: 0.5 }, { x: 0.8, y: 0, width: 0.5, height: 0.5 }])('无效结果不当作正常空主体缓存 %j', async invalid => {
    mocks.fetch.mockImplementation(async () => new Response(JSON.stringify({ box: invalid })))
    const cache = new SubjectDetectionCache('owner'); const image = input()
    await expect(cache.read(image)).rejects.toThrow('无效结果')
    await expect(cache.read(image)).rejects.toThrow('无效结果')
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })
  it('正文读取也受 55 秒截止控制，超时后能够重新检测', async () => {
    vi.useFakeTimers()
    mocks.fetch.mockImplementation(async (_url, init) => ({
      ok: true, status: 200,
      json: () => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))),
    }))
    const first = detectImageSubject(input()).catch(error => error)
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(55_000)
    expect((await first).name).toBe('TimeoutError')
  })
})

