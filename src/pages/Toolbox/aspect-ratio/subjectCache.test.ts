import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SubjectDetectionCache, SUBJECT_CACHE_MS, SUBJECT_EMPTY_CACHE_MS } from './subjectCache'
import { cropFocusForImage } from './subjectFocus'
const image = () => ({ file: new File(['one'], '同名.jpg', { type: 'image/jpeg' }), width: 3200, height: 5035 })
const box = { x: 0.2, y: 0.1, width: 0.5, height: 0.4 }

describe('主体检测缓存', () => {
  beforeEach(() => { vi.spyOn(console, 'debug').mockImplementation(() => undefined) })
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
  it('同图切换平台复用主体框，重新计算焦点；缓存值不能被调用方修改', async () => {
    const detect = vi.fn(async () => ({ box: { ...box } }))
    const cache = new SubjectDetectionCache('owner', detect)
    const input = image()
    const first = await cropFocusForImage(input, { strategy: 'crop', fx: 0.5, fy: 0.5 }, 1600, 1600, value => cache.read(value))
    const second = await cropFocusForImage(input, { strategy: 'crop', fx: 0, fy: 0 }, 900, 1600, value => cache.read(value))
    expect(first?.source).toBe('subject'); expect(second?.source).toBe('subject')
    expect(first).not.toEqual(second)
    const value = await cache.read(input); value.box!.x = 0.9
    expect((await cache.read(input)).box).toEqual(box)
    expect(detect).toHaveBeenCalledTimes(1)
    expect(console.debug).toHaveBeenCalledWith('[主体检测]', expect.objectContaining({ source: 'cache', requestCount: 0 }))
  })
  it('同名同大小的新文件以及尺寸变化不误命中', async () => {
    const detect = vi.fn(async () => ({ box }))
    const cache = new SubjectDetectionCache('owner', detect)
    const input = image()
    await cache.read(input); await cache.read(image()); await cache.read({ ...input, width: 2000 })
    expect(detect).toHaveBeenCalledTimes(3)
  })
  it.each([true, false])('绝对有效期不因命中延长，主体存在=%s', async found => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0)
    const detect = vi.fn(async () => ({ box: found ? box : null }))
    const cache = new SubjectDetectionCache('owner', detect); const input = image()
    await cache.read(input)
    const ttl = found ? SUBJECT_CACHE_MS : SUBJECT_EMPTY_CACHE_MS
    clock.mockReturnValue(ttl - 1); await cache.read(input)
    clock.mockReturnValue(ttl); await cache.read(input)
    expect(detect).toHaveBeenCalledTimes(2)
  })
  it('同图合并请求，一个调用方取消不影响其他等待者', async () => {
    let finish!: (value: { box: typeof box }) => void
    const detect = vi.fn((_input, options) => new Promise<{ box: typeof box }>(resolve => {
      expect(options.signal.aborted).toBe(false); finish = resolve
    }))
    const cache = new SubjectDetectionCache('owner', detect); const input = image()
    const controller = new AbortController()
    const first = cache.read(input, { signal: controller.signal }).catch(error => error)
    const second = cache.read(input)
    await vi.waitFor(() => expect(detect).toHaveBeenCalledTimes(1))
    controller.abort()
    expect((await first).name).toBe('AbortError')
    expect(detect.mock.calls[0][1].signal.aborted).toBe(false)
    finish({ box })
    expect(await second).toEqual({ box })
    await cache.read(input); expect(detect).toHaveBeenCalledTimes(1)
  })
  it.each(['cancel', 'owner', 'remove', 'clear'] as const)('%s 中止底层并阻止迟到值进入缓存', async action => {
    let finish!: (value: { box: typeof box }) => void
    const detect = vi.fn((_input, _options) => new Promise<{ box: typeof box }>(resolve => {
      expect(_input.file).toBeInstanceOf(File)
      expect(_options.signal.aborted).toBe(false)
      finish = resolve
    }))
    const cache = new SubjectDetectionCache('owner', detect); const input = image()
    const controller = new AbortController()
    const first = cache.read(input, { signal: controller.signal }).catch(error => error)
    await vi.waitFor(() => expect(detect).toHaveBeenCalledTimes(1))
    if (action === 'cancel') controller.abort()
    else if (action === 'owner') cache.setOwner('new-owner')
    else if (action === 'remove') cache.remove(input.file)
    else cache.clear()
    expect((await first).name).toBe('AbortError')
    expect(detect.mock.calls[0][1].signal.aborted).toBe(true)
    finish({ box }); await Promise.resolve()
    detect.mockImplementation(async () => ({ box }))
    expect(await cache.read(input)).toEqual({ box })
    expect(detect).toHaveBeenCalledTimes(2)
  })
  it('错误不缓存，正常空结果缓存并仍使用当前九宫格', async () => {
    const detect = vi.fn().mockRejectedValueOnce(new Error('网络失败')).mockResolvedValue({ box: null })
    const cache = new SubjectDetectionCache('owner', detect); const input = image()
    await expect(cache.read(input)).rejects.toThrow('网络失败')
    await cache.read(input)
    const result = await cropFocusForImage(input, { strategy: 'crop', fx: 0, fy: 1 }, 1600, 1600, value => cache.read(value))
    expect(result).toMatchObject({ source: 'grid', fx: 0, fy: 1 })
    expect(detect).toHaveBeenCalledTimes(2)
  })
  it('最多保留二十条，淘汰最久未使用的记录', async () => {
    const detect = vi.fn(async () => ({ box }))
    const cache = new SubjectDetectionCache('owner', detect); const inputs = Array.from({ length: 21 }, image)
    for (const input of inputs) await cache.read(input)
    await cache.read(inputs[20]); expect(detect).toHaveBeenCalledTimes(21)
    await cache.read(inputs[0]); expect(detect).toHaveBeenCalledTimes(22)
  })
})
