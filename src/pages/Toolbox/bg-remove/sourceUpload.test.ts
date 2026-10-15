import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { uploadTaskInput } from '@/services/api/upload'
import {
  BG_REMOVE_SOURCE_CACHE_LIMIT, BG_REMOVE_SOURCE_CACHE_MS,
  BgRemoveSourceUploads, type BgRemoveSourceMetrics,
} from './sourceUpload'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const file = (value = 1, type = 'image/png') => new Blob([new Uint8Array([137, 80, 78, 71, value])], { type })
const scope = '同一账号:production'
beforeEach(() => { vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('抠图原图上传复用', () => {
  it('不同文件实例内容相同只上传一次，原字节保持不变', async () => {
    const upload = vi.fn<typeof uploadTaskInput>().mockResolvedValue('原图对象')
    const cache = new BgRemoveSourceUploads(upload)
    const first = file()
    await expect(cache.read(first, { scope })).resolves.toBe('原图对象')
    const metrics = vi.fn()
    await expect(cache.read(file(), { scope, onMetrics: metrics })).resolves.toBe('原图对象')
    expect(upload).toHaveBeenCalledTimes(1)
    expect(upload.mock.calls[0][0]).toBe(first)
    expect(new Uint8Array(await upload.mock.calls[0][0].arrayBuffer())).toEqual(new Uint8Array(await first.arrayBuffer()))
    expect(metrics).toHaveBeenCalledWith(expect.objectContaining({ source: 'cache', fingerprint: 'sha256', outcome: 'success' }))
    expect(metrics.mock.calls[0][0].upload).toBeUndefined()
  })

  it('大小相同但内容或格式不同不误用上传对象', async () => {
    const upload = vi.fn<typeof uploadTaskInput>().mockResolvedValue('原图对象')
    const cache = new BgRemoveSourceUploads(upload)
    await cache.read(file(1), { scope })
    await cache.read(file(2), { scope })
    await cache.read(file(1, 'image/jpeg'), { scope })
    expect(upload).toHaveBeenCalledTimes(3)
  })

  it('同时重新选择相同内容时合并正在进行的上传', async () => {
    const pending = deferred<string>()
    const upload = vi.fn<typeof uploadTaskInput>().mockReturnValue(pending.promise)
    const cache = new BgRemoveSourceUploads(upload)
    const metrics: BgRemoveSourceMetrics[] = []
    const first = cache.read(file(), { scope, onMetrics: value => metrics.push(value) })
    const second = cache.read(file(), { scope, onMetrics: value => metrics.push(value) })
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
    pending.resolve('共享原图')
    await expect(Promise.all([first, second])).resolves.toEqual(['共享原图', '共享原图'])
    expect(metrics.map(value => value.source).sort()).toEqual(['inflight', 'upload'])
  })

  it('超过复用有效期后重新上传', async () => {
    let now = 0
    const upload = vi.fn<typeof uploadTaskInput>().mockResolvedValueOnce('旧对象').mockResolvedValueOnce('新对象')
    const cache = new BgRemoveSourceUploads(upload, () => now)
    await cache.read(file(), { scope })
    now = BG_REMOVE_SOURCE_CACHE_MS + 1
    await expect(cache.read(file(), { scope })).resolves.toBe('新对象')
    expect(upload).toHaveBeenCalledTimes(2)
  })

  it('服务器确认对象已清理后可失效缓存，下一次主动调用才重新上传', async () => {
    const upload = vi.fn<typeof uploadTaskInput>().mockResolvedValueOnce('旧对象').mockResolvedValueOnce('新对象')
    const cache = new BgRemoveSourceUploads(upload)
    await cache.read(file(), { scope })
    cache.invalidate(scope, '旧对象')
    expect(upload).toHaveBeenCalledTimes(1)
    await expect(cache.read(file(), { scope })).resolves.toBe('新对象')
  })

  it('复用元数据有容量上限，最久未使用的记录淘汰', async () => {
    const upload = vi.fn<typeof uploadTaskInput>().mockResolvedValue('对象')
    const cache = new BgRemoveSourceUploads(upload)
    for (let value = 0; value <= BG_REMOVE_SOURCE_CACHE_LIMIT; value++) await cache.read(file(value), { scope })
    await cache.read(file(0), { scope })
    expect(upload).toHaveBeenCalledTimes(BG_REMOVE_SOURCE_CACHE_LIMIT + 2)
  })

  it('大图上传最多同时两个，空出位置后才开始下一张', async () => {
    const pending = [deferred<string>(), deferred<string>(), deferred<string>()]
    const upload = vi.fn<typeof uploadTaskInput>()
      .mockReturnValueOnce(pending[0].promise).mockReturnValueOnce(pending[1].promise).mockReturnValueOnce(pending[2].promise)
    const cache = new BgRemoveSourceUploads(upload)
    const results = [1, 2, 3].map(value => cache.read(file(value), { scope }))
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(2))
    pending[0].resolve('第一个对象')
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(3))
    pending[1].resolve('第二个对象'); pending[2].resolve('第三个对象')
    await Promise.all(results)
  })

  it('一个使用者取消不会中止另一个使用者的共享上传', async () => {
    const pending = deferred<string>()
    const upload = vi.fn<typeof uploadTaskInput>().mockReturnValue(pending.promise)
    const cache = new BgRemoveSourceUploads(upload)
    const image = file()
    const abort = new AbortController()
    const first = cache.read(image, { scope, signal: abort.signal }).catch(error => error)
    const second = cache.read(image, { scope })
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
    abort.abort()
    expect((await first).name).toBe('AbortError')
    expect(upload.mock.calls[0][2]?.aborted).toBe(false)
    pending.resolve('共享对象')
    await expect(second).resolves.toBe('共享对象')
  })

  it('所有使用者取消时中止上传，迟到结果不能进入缓存', async () => {
    const pending = deferred<string>()
    const upload = vi.fn<typeof uploadTaskInput>().mockReturnValueOnce(pending.promise).mockResolvedValueOnce('新对象')
    const cache = new BgRemoveSourceUploads(upload)
    const abort = new AbortController()
    const otherAbort = new AbortController()
    const image = file()
    const first = cache.read(image, { scope, signal: abort.signal }).catch(error => error)
    const second = cache.read(image, { scope, signal: otherAbort.signal }).catch(error => error)
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
    abort.abort()
    expect((await first).name).toBe('AbortError')
    expect(upload.mock.calls[0][2]?.aborted).toBe(false)
    otherAbort.abort()
    expect((await second).name).toBe('AbortError')
    expect(upload.mock.calls[0][2]?.aborted).toBe(true)
    pending.resolve('迟到对象')
    await expect(cache.read(file(), { scope })).resolves.toBe('新对象')
    expect(upload).toHaveBeenCalledTimes(2)
  })

  it('排队时取消不会发起第三个上传', async () => {
    const digest = vi.spyOn(webcrypto.subtle, 'digest')
    const pending = [deferred<string>(), deferred<string>()]
    const upload = vi.fn<typeof uploadTaskInput>().mockReturnValueOnce(pending[0].promise).mockReturnValueOnce(pending[1].promise)
    const cache = new BgRemoveSourceUploads(upload)
    const first = cache.read(file(1), { scope })
    const second = cache.read(file(2), { scope })
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(2))
    const abort = new AbortController()
    const third = cache.read(file(3), { scope, signal: abort.signal }).catch(error => error)
    await vi.waitFor(() => expect(digest).toHaveBeenCalledTimes(3))
    await digest.mock.results[2].value
    await Promise.resolve()
    abort.abort()
    expect((await third).name).toBe('AbortError')
    pending[0].resolve('一'); pending[1].resolve('二')
    await Promise.all([first, second])
    expect(upload).toHaveBeenCalledTimes(2)
  })

  it('切换账号或运行环境时清空复用记录并拒绝旧上传结果', async () => {
    const pending = deferred<string>()
    const upload = vi.fn<typeof uploadTaskInput>().mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce('另一环境').mockResolvedValueOnce('另一账号')
    const cache = new BgRemoveSourceUploads(upload)
    const first = cache.read(file(), { scope }).catch(error => error)
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
    await expect(cache.read(file(), { scope: '同一账号:preview' })).resolves.toBe('另一环境')
    expect((await first).name).toBe('AbortError')
    expect(upload.mock.calls[0][2]?.aborted).toBe(true)
    pending.resolve('旧账号迟到对象')
    await expect(cache.read(file(), { scope: '另一账号:preview' })).resolves.toBe('另一账号')
    expect(upload).toHaveBeenCalledTimes(3)
  })

  it('摘要计算期间切换会话，旧图片不会开始上传', async () => {
    const digest = deferred<ArrayBuffer>()
    const actualDigest = webcrypto.subtle.digest.bind(webcrypto.subtle)
    vi.spyOn(webcrypto.subtle, 'digest').mockImplementationOnce(() => digest.promise)
    const upload = vi.fn<typeof uploadTaskInput>().mockResolvedValue('新会话对象')
    const cache = new BgRemoveSourceUploads(upload)
    const first = cache.read(file(1), { scope }).catch(error => error)
    await vi.waitFor(() => expect(webcrypto.subtle.digest).toHaveBeenCalledTimes(1))
    await cache.read(file(2), { scope: '另一账号:production' })
    digest.resolve(await actualDigest('SHA-256', new Uint8Array([1])))
    expect((await first).name).toBe('AbortError')
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('缺少摘要能力时只按同一个文件实例复用', async () => {
    vi.stubGlobal('crypto', {})
    const upload = vi.fn<typeof uploadTaskInput>().mockResolvedValue('对象')
    const cache = new BgRemoveSourceUploads(upload)
    const image = file()
    await cache.read(image, { scope }); await cache.read(image, { scope }); await cache.read(file(), { scope })
    expect(upload).toHaveBeenCalledTimes(2)
  })

  it('失败上传不保留对象，下次主动调用可恢复', async () => {
    const upload = vi.fn<typeof uploadTaskInput>().mockRejectedValueOnce(new Error('上传失败')).mockResolvedValueOnce('对象')
    const cache = new BgRemoveSourceUploads(upload)
    await expect(cache.read(file(), { scope })).rejects.toThrow('上传失败')
    await expect(cache.read(file(), { scope })).resolves.toBe('对象')
    expect(upload).toHaveBeenCalledTimes(2)
  })
})
