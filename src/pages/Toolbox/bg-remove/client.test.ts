// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BatchImage } from './types'
const mocks = vi.hoisted(() => ({ upload: vi.fn(), signed: vi.fn() }))
vi.mock('@/services/api/upload', () => ({ uploadTaskInput: mocks.upload, uploadImage: vi.fn() }))
vi.mock('@/services/api/objects', () => ({ signedOwnedObjectUrl: mocks.signed }))
vi.mock('@/services/api/task', () => ({ liveCapabilityReady: () => false, createTask: vi.fn(), getTask: vi.fn() }))
import { requestMatte } from './client'

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
function image(size = 20): BatchImage {
  return { id: 'item', file: new File([new Uint8Array([255, 216, 255]), new Uint8Array(size - 3)], '旧格式.png', { type: 'image/png' }),
    sourceMime: 'image/png', sourceUrl: '', width: 100, height: 80, status: 'pending' }
}
function response() { return new Response(png, { headers: { 'Content-Type': 'image/png' } }) }
function objectResponse() { return new Response(JSON.stringify({ objectKey: 'temporary/bg-remove-results/u/1.png',
  url: 'https://r2.test/result', mimeType: 'image/png', bytes: png.length, expiresAt: 100 }), { headers: { 'Content-Type': 'application/json' } }) }

beforeEach(() => {
  mocks.upload.mockReset().mockResolvedValue('temporary/task-inputs/u/image')
  mocks.signed.mockReset().mockResolvedValue('https://r2.test/refreshed')
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 100, height: 80, close: vi.fn() })))
  if (typeof AbortSignal.timeout !== 'function') Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: () => new AbortController().signal })
  if (typeof AbortSignal.any !== 'function') Object.defineProperty(AbortSignal, 'any', {
    configurable: true, value: (signals: AbortSignal[]) => {
      const controller = new AbortController()
      signals.forEach(signal => signal.aborted ? controller.abort() : signal.addEventListener('abort', () => controller.abort(), { once: true }))
      return controller.signal
    },
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('智能抠图对象传输与可恢复下载', () => {
  it('小图按真实 JPEG 内联提交，返回透明 PNG', async () => {
    const fetch = vi.fn(async () => response())
    vi.stubGlobal('fetch', fetch)
    const matte = await requestMatte(image(), () => false)
    const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(body).toMatchObject({ mimeType: 'image/jpeg', dataBase64: expect.any(String), clientTimingMs: expect.any(Object) })
    expect(body.sourceImageKey).toBeUndefined()
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(matte.type).toBe('image/png')
  })

  it('5 MB 图片只提交对象键，处理失败后不重复上传', async () => {
    let current = image(5 * 1024 * 1024)
    const onTransfer = (transfer: NonNullable<BatchImage['transfer']>) => { current = { ...current, transfer } }
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: '腾讯连接失败' }), { status: 502 })).mockResolvedValueOnce(response())
    vi.stubGlobal('fetch', fetch)
    await expect(requestMatte(current, () => false, { ownerId: 'u', onTransfer })).rejects.toThrow('腾讯连接失败')
    await requestMatte(current, () => false, { ownerId: 'u', onTransfer })
    expect(mocks.upload).toHaveBeenCalledTimes(1)
    for (const [, init] of fetch.mock.calls) {
      const body = JSON.parse(String(init.body))
      expect(body.sourceImageKey).toBe('temporary/task-inputs/u/image')
      expect(body.dataBase64).toBeUndefined()
      expect(String(init.body).length).toBeLessThan(1000)
    }
  })

  it('大结果下载失败后只重试下载，签名失效刷新一次', async () => {
    let current = image()
    const onTransfer = (transfer: NonNullable<BatchImage['transfer']>) => { current = { ...current, transfer } }
    const fetch = vi.fn().mockResolvedValueOnce(objectResponse()).mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 403 })).mockResolvedValueOnce(response())
    vi.stubGlobal('fetch', fetch)
    await expect(requestMatte(current, () => false, { ownerId: 'u', onTransfer })).rejects.toThrow('读取抠图结果失败')
    expect(current.transfer?.result?.objectKey).toBe('temporary/bg-remove-results/u/1.png')
    await requestMatte(current, () => false, { ownerId: 'u', onTransfer })
    expect(fetch.mock.calls.filter(([url]) => url === '/api/bg-remove')).toHaveLength(1)
    expect(mocks.signed).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls.some(([url]) => String(url).startsWith('/api/objects'))).toBe(false)
  })

  it('已清理的结果重新处理，已清理的原图重新上传一次', async () => {
    let current = image(5 * 1024 * 1024)
    current.transfer = { ownerId: 'u', sourceImageKey: 'temporary/task-inputs/u/old', result: {
      objectKey: 'temporary/bg-remove-results/u/old.png', url: 'https://r2.test/old', mimeType: 'image/png',
    } }
    const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'OBJECT_NOT_FOUND' }), { status: 404 })).mockResolvedValueOnce(response())
    vi.stubGlobal('fetch', fetch)
    await requestMatte(current, () => false, { ownerId: 'u', onTransfer: transfer => { current = { ...current, transfer } } })
    expect(mocks.upload).toHaveBeenCalledTimes(1)
    expect(current.transfer?.sourceImageKey).toBe('temporary/task-inputs/u/image')
    expect(current.transfer?.result).toBeUndefined()
    expect(fetch.mock.calls.filter(([url]) => url === '/api/bg-remove')).toHaveLength(2)
  })

  it('账号不同不复用对象和结果，结果尺寸异常清除缓存', async () => {
    let current = image(5 * 1024 * 1024)
    current.transfer = { ownerId: 'other', sourceImageKey: 'temporary/task-inputs/other/image' }
    const fetch = vi.fn().mockResolvedValueOnce(objectResponse()).mockResolvedValueOnce(response())
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 50, height: 80, close: vi.fn() })))
    await expect(requestMatte(current, () => false, { ownerId: 'u', onTransfer: transfer => { current = { ...current, transfer } } })).rejects.toThrow('尺寸与原图不一致')
    expect(mocks.upload).toHaveBeenCalledTimes(1)
    expect(current.transfer?.ownerId).toBe('u')
    expect(current.transfer?.result).toBeUndefined()
  })

  it('取消上传会中止请求，不调用腾讯接口', async () => {
    const abort = new AbortController()
    mocks.upload.mockImplementation((_file, _mime, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('取消', 'AbortError')), { once: true })
    }))
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const pending = requestMatte(image(5 * 1024 * 1024), () => false, { ownerId: 'u', signal: abort.signal })
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1))
    abort.abort()
    await rejection
    expect(fetch).not.toHaveBeenCalled()
  })
  it('取消结果下载时保留结果描述，不刷新签名或重复生成', async () => {
    const abort = new AbortController()
    let current = image()
    const fetch = vi.fn().mockResolvedValueOnce(objectResponse()).mockImplementationOnce((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('取消', 'AbortError')), { once: true })
    }))
    vi.stubGlobal('fetch', fetch)
    const pending = requestMatte(current, () => false, { ownerId: 'u', signal: abort.signal, onTransfer: transfer => { current = { ...current, transfer } } })
    const rejection = pending.catch(error => error)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    abort.abort()
    expect(await rejection).toMatchObject({ name: 'AbortError' })
    expect(current.transfer?.result).toBeDefined()
    expect(mocks.signed).not.toHaveBeenCalled()
  })
})
