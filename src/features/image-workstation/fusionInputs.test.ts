import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createImageAsset } from '@/editor/services/assetService'
import { FusionInputPreparation, FUSION_INPUT_CACHE_MS, FUSION_INPUT_TIMEOUT_MS, type FusionInputStatus, type FusionInputRole } from './fusionInputs'

const mocks = vi.hoisted(() => ({ sign: vi.fn() }))
vi.mock('@/services/api/client', () => ({ apiClient: { post: mocks.sign } }))
const bytes = (size: number) => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...Array(size - 8).fill(0)])
const product = createImageAsset({ id: 'product', name: '商品', url: 'product.png', mimeType: 'image/png', width: 3200, height: 5035 })
const reference = createImageAsset({ id: 'scene', name: '场景', url: 'scene.png', mimeType: 'image/png', width: 2400, height: 2400 })
const pending = new Map<string, (status: number) => void>()
let statuses: Partial<Record<FusionInputRole, FusionInputStatus>>
function options(controller = new AbortController()) {
  return { ownerId: 'owner', signal: controller.signal, isCurrent: () => true, onStatus: (role: FusionInputRole, state: FusionInputStatus) => { statuses[role] = state } }
}
function complete(role: FusionInputRole, status = 200) { pending.get(`https://r2.test/${role === 'product' ? 9 : 10}`)!(status) }
async function bothStarted() { await vi.waitFor(() => expect(pending.size).toBe(2)) }

describe('融合输入准备', () => {
  beforeEach(() => {
    statuses = {}; pending.clear()
    vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    mocks.sign.mockReset().mockImplementation(async (_path, body: { size: number }) => ({ uploadUrl: `https://r2.test/${body.size}`, objectKey: `temporary/owner/${body.size}` }))
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method !== 'PUT') return Promise.resolve(new Response(bytes(url === product.url ? 9 : 10), { headers: { 'Content-Type': 'image/png' } }))
      return new Promise<Response>((resolve, reject) => {
        pending.set(url, status => resolve(new Response(null, { status })))
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      })
    }))
  })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('两次 PUT 同时启动，场景先完成也不交换商品与场景对象键', async () => {
    const operation = new FusionInputPreparation().prepare(product, reference, options())
    await bothStarted()
    expect(statuses.product?.stage).toBe('uploading')
    expect(statuses.reference?.stage).toBe('uploading')
    complete('reference')
    await vi.waitFor(() => expect(statuses.reference?.stage).toBe('ready'))
    expect(statuses.product?.stage).toBe('uploading')
    complete('product')
    expect(await operation).toEqual({ product: 'temporary/owner/9', reference: 'temporary/owner/10' })
    for (const [, init] of vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PUT')) {
      expect(init?.credentials).toBe('omit')
      expect(init?.headers).toEqual({ 'Content-Type': 'image/png' })
    }
    expect(JSON.stringify(vi.mocked(console.debug).mock.calls)).not.toMatch(/https:|data:|Authorization/)
  })

  it.each(['product', 'reference'] as const)('一张失败时另一张继续，%s 失败重试只重新上传该项', async failedRole => {
    const helper = new FusionInputPreparation()
    const operation = helper.prepare(product, reference, options()).catch(error => error)
    await bothStarted()
    complete(failedRole, 500)
    await vi.waitFor(() => expect(statuses[failedRole]?.stage).toBe('failed'))
    const other = failedRole === 'product' ? 'reference' : 'product'
    expect(statuses[other]?.stage).toBe('uploading')
    let finished = false
    void operation.then(() => { finished = true })
    await Promise.resolve()
    expect(finished).toBe(false)
    complete(other)
    expect((await operation).failures).toEqual({ [failedRole]: '原图上传失败，请重试' })
    pending.clear()
    const retry = helper.prepare(product, reference, options())
    await vi.waitFor(() => expect(pending.size).toBe(1))
    complete(failedRole)
    expect(await retry).toEqual({ product: 'temporary/owner/9', reference: 'temporary/owner/10' })
    expect(mocks.sign).toHaveBeenCalledTimes(3)
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(3)
  })

  it('已有对象键直接复用，混合输入只上传缺失的场景图', async () => {
    const helper = new FusionInputPreparation()
    expect(await helper.prepare(product, reference, options(), { product: 'existing-product', reference: 'existing-scene' }))
      .toEqual({ product: 'existing-product', reference: 'existing-scene' })
    expect(fetch).not.toHaveBeenCalled()
    const operation = helper.prepare({ ...product, storage: { provider: 'r2', objectKey: 'existing-product', projectId: 'project' } }, reference, options())
    await vi.waitFor(() => expect(pending.size).toBe(1))
    complete('reference')
    expect(await operation).toEqual({ product: 'existing-product', reference: 'temporary/owner/10' })
  })

  it.each(['reading', 'signing'] as const)('%s 阶段失败不影响另一图，重试复用已完成图', async phase => {
    const helper = new FusionInputPreparation()
    if (phase === 'reading') {
      vi.mocked(fetch).mockImplementationOnce(async () => { throw new TypeError('Failed to fetch') })
    } else {
      mocks.sign.mockImplementation(async (_path, body: { size: number }) => {
        if (body.size === 9) throw new TypeError('Failed to fetch')
        return { uploadUrl: `https://r2.test/${body.size}`, objectKey: `temporary/owner/${body.size}` }
      })
    }
    const first = helper.prepare(product, reference, options()).catch(error => error)
    await vi.waitFor(() => {
      expect(statuses.product?.stage).toBe('failed')
      expect(pending.size).toBe(1)
    })
    expect(statuses.reference?.stage).toBe('uploading')
    complete('reference')
    expect((await first).failures.product).toBe(phase === 'reading' ? '图片读取中断，请重试失败图片' : '申请上传地址中断，请重试失败图片')
    expect(console.debug).toHaveBeenCalledWith('[融合输入]', expect.objectContaining({ operation: 'complete', outcome: 'failed', putAttempts: 1 }))
    pending.clear()
    mocks.sign.mockImplementation(async (_path, body: { size: number }) => ({ uploadUrl: `https://r2.test/${body.size}`, objectKey: `temporary/owner/${body.size}` }))
    const retry = helper.prepare(product, reference, options())
    await vi.waitFor(() => expect(pending.size).toBe(1))
    complete('product')
    expect(await retry).toEqual({ product: 'temporary/owner/9', reference: 'temporary/owner/10' })
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(2)
  })

  it('成功键在 30 分钟内复用，到期后重新上传；换单图仅失效该槽位', async () => {
    const helper = new FusionInputPreparation()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const first = helper.prepare(product, reference, options())
    await bothStarted(); complete('product'); complete('reference'); await first
    pending.clear()
    await helper.prepare({ ...product }, { ...reference }, options())
    expect(mocks.sign).toHaveBeenCalledTimes(2)
    const changed = { ...reference, id: 'new-scene', url: 'new-scene.png' }
    const second = helper.prepare(product, changed, options())
    await vi.waitFor(() => expect(pending.size).toBe(1))
    complete('reference'); await second
    expect(mocks.sign).toHaveBeenCalledTimes(3)
    clock.mockReturnValue(1000 + FUSION_INPUT_CACHE_MS)
    pending.clear()
    const expired = helper.prepare(product, changed, options())
    await bothStarted(); complete('product'); complete('reference'); await expired
    expect(mocks.sign).toHaveBeenCalledTimes(5)
  })

  it('取消中止两张上传，已完成图仍可在同账号下一轮复用', async () => {
    const helper = new FusionInputPreparation()
    const controller = new AbortController()
    const first = helper.prepare(product, reference, options(controller)).catch(error => error)
    await bothStarted()
    complete('product'); await vi.waitFor(() => expect(statuses.product?.stage).toBe('ready'))
    controller.abort()
    expect((await first).name).toBe('AbortError')
    expect(console.debug).toHaveBeenCalledWith('[融合输入]', expect.objectContaining({ operation: 'complete', outcome: 'cancelled', putAttempts: 2 }))
    pending.clear()
    const retry = helper.prepare(product, reference, options())
    await vi.waitFor(() => expect(pending.size).toBe(1))
    complete('reference'); await retry
    expect(mocks.sign).toHaveBeenCalledTimes(3)
  })

  it('换账号不复用另一账号的成功键', async () => {
    const helper = new FusionInputPreparation()
    const first = helper.prepare(product, reference, options())
    await bothStarted(); complete('product'); complete('reference'); await first
    pending.clear()
    const second = helper.prepare(product, reference, { ...options(), ownerId: 'other-owner' })
    await bothStarted(); complete('product'); complete('reference'); await second
    expect(mocks.sign).toHaveBeenCalledTimes(4)
  })

  it('120 秒总限时覆盖未完成的 PUT，两图均失败并允许重试', async () => {
    vi.useFakeTimers()
    const operation = new FusionInputPreparation().prepare(product, reference, options()).catch(error => error)
    await bothStarted()
    await vi.advanceTimersByTimeAsync(FUSION_INPUT_TIMEOUT_MS)
    expect((await operation).failures).toEqual({ product: '图片准备超时，请重试失败图片', reference: '图片准备超时，请重试失败图片' })
  })
})
