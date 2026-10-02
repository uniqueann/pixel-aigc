import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ proxy: vi.fn(), local: vi.fn() }))
vi.mock('./objects', () => ({ fetchOwnedObject: mocks.proxy, OwnedObjectError: class OwnedObjectError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'OwnedObjectError' }
} }))
vi.mock('@/features/assets/workstationHistory', () => ({ readHistoryImage: mocks.local }))
vi.mock('@/features/assets/historyOwner', () => ({ currentWorkstationHistoryOwner: () => 'a' }))
import { readOwnedImage, clearOwnedImageSession } from './ownedImages'
import { useUserStore } from '@/store/useUserStore'
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const reference = (key = 'result') => ({ objectKey: key, url: `https://r2.test/${key}?X-Amz-Signature=SECRET`, expiresAt: Date.now() + 60_000, mimeType: 'image/png' })
const blob = () => new Blob([png], { type: 'image/png' })
beforeEach(() => {
  clearOwnedImageSession()
  mocks.local.mockReset().mockResolvedValue(undefined)
  mocks.proxy.mockReset().mockImplementation(async () => blob())
})
afterEach(() => { clearOwnedImageSession(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('共享图片读取', () => {
  it('并发预览、保存、下载共用一次同源代理，后续复用同一 Blob，不直连签名地址', async () => {
    const [first, second] = await Promise.all([readOwnedImage(reference()), readOwnedImage(reference())])
    expect(first).toBe(second)
    expect(await readOwnedImage(reference())).toBe(first)
    expect(mocks.proxy).toHaveBeenCalledTimes(1)
    expect(mocks.proxy).toHaveBeenCalledWith('result', undefined, expect.any(AbortSignal))
  })
  it('本地历史和已有 Blob 不请求网络，并纠正真实格式', async () => {
    mocks.local.mockResolvedValue(new Blob([png], { type: 'image/jpeg' }))
    expect((await readOwnedImage(reference())).type).toBe('image/png')
    clearOwnedImageSession()
    expect((await readOwnedImage({ blob: new Blob([png], { type: 'image/png' }) })).type).toBe('image/png')
    expect(mocks.proxy).not.toHaveBeenCalled()
  })
  it('单个使用方取消不影响另一个，共同取消中止底层下载', async () => {
    let finish!: () => void
    mocks.proxy.mockImplementation((_key: string, _filename: string | undefined, signal?: AbortSignal) => new Promise<Blob>((resolve, reject) => {
      finish = () => resolve(blob())
      signal?.addEventListener('abort', () => reject(signal.reason))
    }))
    const a = new AbortController(), b = new AbortController()
    const first = readOwnedImage(reference(), { signal: a.signal }).catch(error => error)
    const second = readOwnedImage(reference(), { signal: b.signal })
    await vi.waitFor(() => expect(mocks.proxy).toHaveBeenCalledTimes(1))
    a.abort(); expect(await first).toMatchObject({ name: 'AbortError' })
    expect(mocks.proxy.mock.calls[0][2]?.aborted).toBe(false)
    finish(); expect((await second).size).toBe(png.length)
    clearOwnedImageSession()
    const c = new AbortController()
    const third = readOwnedImage(reference(), { signal: c.signal }).catch(error => error)
    await vi.waitFor(() => expect(mocks.proxy).toHaveBeenCalledTimes(2))
    c.abort(); expect(await third).toMatchObject({ name: 'AbortError' })
    expect(mocks.proxy.mock.calls[1][2]?.aborted).toBe(true)
  })
  it('全局最多两个下载，排队后才请求代理', async () => {
    const releases: Array<() => void> = []
    mocks.proxy.mockImplementation(() => new Promise<Blob>(resolve => releases.push(() => resolve(blob()))))
    const reads = [readOwnedImage(reference('1')), readOwnedImage(reference('2')), readOwnedImage(reference('3'))]
    await vi.waitFor(() => expect(mocks.proxy).toHaveBeenCalledTimes(2))
    releases[0](); await vi.waitFor(() => expect(mocks.proxy).toHaveBeenCalledTimes(3))
    releases[1](); releases[2](); await Promise.all(reads)
  })
  it('代理 404 不重试；账号切换停止旧请求', async () => {
    const { OwnedObjectError } = await import('./objects')
    mocks.proxy.mockRejectedValueOnce(new OwnedObjectError(404, '结果对象不存在'))
      .mockImplementation((_key: string, _filename: string | undefined, signal?: AbortSignal) => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason))))
    await expect(readOwnedImage(reference())).rejects.toThrow('结果对象不存在')
    expect(mocks.proxy).toHaveBeenCalledTimes(1)
    const old = readOwnedImage(reference()).catch(error => error)
    await vi.waitFor(() => expect(mocks.proxy).toHaveBeenCalledTimes(2))
    useUserStore.getState().setUser('b', 'free')
    expect(await old).toMatchObject({ name: 'AbortError' })
  })
  it('账号隔离，超过 32 项淘汰最早缓存', async () => {
    await readOwnedImage(reference(), { ownerId: 'a' }); await readOwnedImage(reference(), { ownerId: 'b' })
    expect(mocks.proxy).toHaveBeenCalledTimes(2)
    clearOwnedImageSession()
    for (let index = 0; index < 33; index++) await readOwnedImage(reference(String(index)))
    await readOwnedImage(reference('0'))
    expect(mocks.proxy).toHaveBeenCalledTimes(36)
  })
  it('60 秒超时也覆盖正文读取', async () => {
    vi.useFakeTimers()
    mocks.proxy.mockImplementation((_key: string, _filename: string | undefined, signal?: AbortSignal) => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason))))
    const read = readOwnedImage(reference()).catch(error => error)
    await vi.advanceTimersByTimeAsync(60_001)
    expect(await read).toMatchObject({ status: 504 })
  })
  it('粗指针设备超过 64 MiB 的图片只由当前使用方持有，不进入长期缓存', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const huge = new Blob([png, new Uint8Array(64 * 1024 * 1024)], { type: 'image/png' })
    expect(await readOwnedImage({ ...reference(), blob: huge })).toBe(huge)
    expect((await readOwnedImage(reference())).size).toBe(png.length)
    expect(mocks.proxy).toHaveBeenCalledTimes(1)
  })

  it('共享请求返回真实格式，每个使用方独立检查 MIME', async () => {
    const incorrect = readOwnedImage({ ...reference(), mimeType: 'image/jpeg' }).catch(error => error)
    const correct = readOwnedImage(reference())
    expect(await incorrect).toMatchObject({ status: 502 })
    expect((await correct).type).toBe('image/png')
    expect(mocks.proxy).toHaveBeenCalledTimes(1)
  })

  it('网络中断映射为可读错误，且调试日志不含签名地址', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    mocks.proxy.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(readOwnedImage(reference())).rejects.toMatchObject({ status: 502 })
    expect(JSON.stringify(debug.mock.calls)).not.toContain('X-Amz-Signature')
    expect(JSON.stringify(debug.mock.calls)).not.toContain('r2.test')
    debug.mockRestore()
  })
})
