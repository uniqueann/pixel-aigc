import type {TaskOrigin} from '../../shared/task-center.js'
import { randomUUID } from 'node:crypto'
import { afterEach,describe,expect,it,vi } from 'vitest'
import { createMockImageProvider,MOCK_PNG_1X1 } from '../image-providers/mock.js'
import { ProviderError,type ImageProvider } from '../image-providers/types.js'
import { createMemoryStore } from './memory-store.js'
import { shouldAdvance } from './state.js'
import { advanceImageClaim,advanceJobInStore,createImageJobInStore,createImageTaskSchema,toClientImageTask,type ImageJobRuntime } from './service.js'

const user = { id: '00000000-0000-4000-8000-000000000001',email: 'alice@example.com',suggestedName: 'A',avatarUrl: null,providers: ['email'] }
const previous = { ...process.env }
afterEach(() => { process.env = { ...previous } })

async function fixture(provider: ImageProvider = createMockImageProvider(),count = 1,origin?:TaskOrigin) {
  process.env.AIGC_RUNTIME_SCOPE = 'local'
  process.env.VERCEL_ENV = 'development'
  process.env.AIGC_IMAGE_MOCK_PROVIDER = 'true'
  let now = Date.now()
  const objects = new Map<string,{ bytes: Uint8Array;contentType: string }>()
  const billing = { reserve: vi.fn(async () => ({ ok: true as const })),settle: vi.fn(async () => undefined),release: vi.fn(async () => undefined) }
  const store = createMemoryStore(user.id)
  const runtime: ImageJobRuntime = { now: () => now,sleep: async () => undefined,fetch: vi.fn(),log: vi.fn(),billing,
    providerFor: () => provider,signRead: async key => ({ url: `https://r2.test/${key}`,expiresAt: now + 900_000 }),
    crop: async bytes => ({ bytes: new Uint8Array(bytes),width: 1,height: 1,mimeType: 'image/png',cropped: false }),
    putObject: vi.fn(async (key,bytes,contentType) => { objects.set(key,{ bytes,contentType }) }),
    getObject: vi.fn(async key => { const object = objects.get(key); if (!object) throw new Error('对象不存在'); return object }),
  }
  const created = await createImageJobInStore(store,user,createImageTaskSchema.parse({ capability: 'text_to_image',
    requestId: randomUUID(),origin,modelProfileId: 'mock:image-stage2',params: { prompt: '测试',count,resolution: '1k',size: { width: 1024,height: 1024 } } }),runtime)
  const claim = async () => {
    const job = await store.tryAcquireLease(created.bundle.job.id,new Date(now + 120_000))
    if (!job) throw new Error('无法领取')
    return { job,items: await store.listItems(job.id) }
  }
  return { ...created,store,runtime,billing,objects,claim,setNow: (value: number) => { now = value },now: () => now }
}

describe('图片持久化执行协议',() => {
  it.each([1_200, 4_000])('查询耗时 %i ms 时从查询开始计间隔，每个请求仍只查一次上游', async duration => {
    const getStatus = vi.fn(async () => {
      f.setNow(f.now() + duration)
      return { state: 'processing' as const }
    })
    const provider = { ...createMockImageProvider({ getStatus }),
      jobPolicy: () => ({ taskTimeoutMs: 300_000, pollIntervalMs: 3_000, initialPollDelayMs: 5_000, maxParallel: 1 }) }
    const f = await fixture(provider)
    const submitted = await advanceImageClaim(f.bundle, f.runtime, true)
    f.setNow(new Date(submitted.job.next_poll_at).getTime())
    const startedAt = f.now()
    const waiting = await advanceImageClaim(await f.claim(), f.runtime)
    expect(new Date(waiting.job.next_poll_at).getTime()).toBe(startedAt + 3_000)
    expect((await toClientImageTask(waiting, f.runtime)).pollAfterMs).toBe(Math.max(1_000, 3_000 - duration))
    expect(getStatus).toHaveBeenCalledTimes(1)
    expect(f.billing.reserve).toHaveBeenCalledTimes(1)
    expect(f.billing.settle).not.toHaveBeenCalled()
    expect(f.billing.release).not.toHaveBeenCalled()
  })
  it.each([false, true])('多上游按最后一次查询计间隔，更晚平台退避不会被提前：%s', async deferred => {
    const starts: number[] = []
    const getStatus = vi.fn(async () => {
      starts.push(f.now())
      f.setNow(f.now() + 600)
      if (deferred && starts.length === 2) await f.store.updateJob(f.bundle.job.id, { next_poll_at: new Date(f.now() + 15_000) })
      return { state: 'processing' as const }
    })
    const provider = { ...createMockImageProvider({ submit: async input => ({ providerTaskId: `task-${input.ordinal}` }), getStatus }),
      jobPolicy: () => ({ taskTimeoutMs: 300_000, pollIntervalMs: 3_000, initialPollDelayMs: 3_000, maxParallel: 2 }) }
    const f = await fixture(provider, 2)
    const submitted = await advanceImageClaim(f.bundle, f.runtime, true)
    f.setNow(new Date(submitted.job.next_poll_at).getTime())
    const waiting = await advanceImageClaim(await f.claim(), f.runtime)
    expect(starts).toHaveLength(2)
    expect(new Date(waiting.job.next_poll_at).getTime()).toBe(deferred ? f.now() + 15_000 : starts[1] + 3_000)
    expect(new Date(waiting.job.next_poll_at).getTime()).toBeGreaterThanOrEqual(starts[1] + 3_000)
    expect(getStatus).toHaveBeenCalledTimes(2)
  })
  it('状态查询超时保留原任务与预扣，下一轮成功只结算一次且不会补生成', async () => {
    const submit = vi.fn(async () => ({ providerTaskId: '原任务编号' }))
    const getStatus = vi.fn().mockRejectedValueOnce(new ProviderError('TIMEOUT', '查询超时', true, 504))
      .mockResolvedValue({ state: 'succeeded', resultUrls: ['https://provider.test/private?token=secret'] })
    const f = await fixture(createMockImageProvider({ submit, getStatus }))
    const submitted = await advanceImageClaim(f.bundle, f.runtime, true)
    const dto = await toClientImageTask(submitted, f.runtime, 'advance')
    expect(dto.pollAfterMs).toBe(new Date(submitted.job.next_poll_at).getTime() - f.now())
    expect(f.runtime.log).toHaveBeenCalledWith(expect.objectContaining({ evt: 'image-job-poll-hint', pollAfterMs: dto.pollAfterMs }))
    f.setNow(new Date(submitted.job.next_poll_at).getTime() + 1)
    const waiting = await advanceImageClaim(await f.claim(), f.runtime)
    expect(waiting.job.billing_state).toBe('reserved')
    expect(waiting.items[0].provider_task_id).toBe('原任务编号')
    expect(f.billing.settle).not.toHaveBeenCalled()
    expect(f.billing.release).not.toHaveBeenCalled()
    f.setNow(new Date(waiting.job.next_poll_at).getTime() + 1)
    const done = await advanceImageClaim(await f.claim(), f.runtime)
    expect(done.job.status).toBe('succeeded')
    expect((await toClientImageTask(done, f.runtime, 'advance')).pollAfterMs).toBeUndefined()
    const logsBeforeSnapshot = vi.mocked(f.runtime.log).mock.calls.length
    for (let index = 0; index < 10; index++) await toClientImageTask(done, f.runtime)
    expect(vi.mocked(f.runtime.log).mock.calls).toHaveLength(logsBeforeSnapshot)
    expect((await f.store.listAttempts(done.job.id)).filter(attempt => attempt.kind === 'transfer').map(attempt => attempt.outcome)).toEqual(['accepted'])
    expect(submit).toHaveBeenCalledTimes(1)
    expect(getStatus.mock.calls.map(([id]) => id)).toEqual(['原任务编号', '原任务编号'])
    expect(f.billing.reserve).toHaveBeenCalledTimes(1)
    expect(f.billing.settle).toHaveBeenCalledTimes(1)
    expect(f.billing.release).not.toHaveBeenCalled()
    const metrics = vi.mocked(f.runtime.log).mock.calls.map(([entry]) => entry).filter(entry => entry.evt === 'image-job-phase')
    expect(metrics.filter(entry => entry.phase === 'status').map(entry => entry.outcome)).toEqual(['failed', 'success'])
    expect(metrics.map(entry => entry.phase)).toEqual(expect.arrayContaining(['prepare', 'reconcile', 'download', 'postprocess', 'transfer-intent', 'store', 'billing', 'persist', 'present']))
    expect(metrics.filter(entry => entry.phase === 'billing')).toHaveLength(1)
    expect(metrics.some(entry => entry.phase === 'finalize')).toBe(false)
    expect(JSON.stringify(metrics)).not.toMatch(/provider\.test|token|secret|generated\//)
  })
  it('来源变化不重复预扣，重入保留首次来源，生成参数变化仍冲突',async()=>{
    const origin:TaskOrigin={entry:'canvas',tool:'text-to-image',projectId:'first',sceneId:'scene',projectSource:'local'}
    const f=await fixture(undefined,1,origin)
    const request={capability:'text_to_image',requestId:f.bundle.job.request_id,modelProfileId:'mock:image-stage2',
      params:{prompt:'测试',count:1,resolution:'1k',size:{width:1024,height:1024}},origin:{...origin,projectId:'second'}}
    const replay=await createImageJobInStore(f.store,user,createImageTaskSchema.parse(request),f.runtime)
    expect(replay.bundle.job.origin).toEqual(origin);expect(f.billing.reserve).toHaveBeenCalledTimes(1)
    await expect(createImageJobInStore(f.store,user,createImageTaskSchema.parse({...request,params:{...request.params,prompt:'新内容'}}),f.runtime)).rejects.toMatchObject({status:409})
    expect(f.billing.reserve).toHaveBeenCalledTimes(1);expect(f.runtime.fetch).not.toHaveBeenCalled()
  })

  it('兼容查询允许截止后的部分成功任务补收，仍遵守退避与恢复窗口',() => {
    const now = Date.now()
    const job = { status: 'succeeded',deadline_at: new Date(now - 60_000),next_poll_at: new Date(now - 1) }
    const items = [{ status: 'succeeded',result_object_key: 'generated/published' },
      { status: 'expired',provider_task_id: 'accepted' }]
    expect(shouldAdvance(job,now,items)).toBe(true)
    expect(shouldAdvance({ ...job,status: 'failed' },now,items)).toBe(true)
    expect(shouldAdvance({ ...job,next_poll_at: new Date(now + 15_000) },now,items)).toBe(false)
    expect(shouldAdvance(job,now + 24 * 60 * 60 * 1000,items)).toBe(false)
    expect(shouldAdvance(job,now,[items[0]])).toBe(false)
  })

  it('平台暂缓提交后保留数据库退避时间，不发送请求或重复预扣',async () => {
    const submit = vi.fn(async () => ({ providerTaskId: 'unexpected' }))
    const f = await fixture(createMockImageProvider({ submit }))
    const deferredUntil = new Date(f.now() + 15_000)
    f.store.startSubmission = async jobId => {
      await f.store.updateJob(jobId,{ next_poll_at: deferredUntil })
      return undefined
    }
    const result = await advanceImageClaim(f.bundle,f.runtime,true)
    expect(new Date(result.job.next_poll_at).getTime()).toBe(deferredUntil.getTime())
    expect(result.items[0].submission_state).toBe('not_sent')
    expect(submit).not.toHaveBeenCalled()
    expect(await f.store.listAttempts(f.bundle.job.id)).toHaveLength(0)
    expect(f.billing.reserve).toHaveBeenCalledTimes(1)
  })

  it('F01：原 POST 阻塞时轮询和维护无法重复领取或发送，预扣一次',async () => {
    let unblock!: () => void
    let started!: () => void
    const entered = new Promise<void>(resolve => { started = resolve })
    const submit = vi.fn(async () => { started(); await new Promise<void>(resolve => { unblock = resolve }); return { providerTaskId: 'original' } })
    const f = await fixture(createMockImageProvider({ submit }))
    const running = advanceImageClaim(f.bundle,f.runtime,true)
    await entered
    expect((await f.store.listItems(f.bundle.job.id))[0].submission_state).toBe('sending')
    const contenders = await Promise.all([f.store.tryAcquireLease(f.bundle.job.id,new Date(f.now() + 120_000)),
      f.store.tryAcquireLease(f.bundle.job.id,new Date(f.now() + 120_000),'maintenance')])
    expect(contenders).toEqual([undefined,undefined])
    unblock()
    await running
    expect(submit).toHaveBeenCalledTimes(1)
    expect(f.billing.reserve).toHaveBeenCalledTimes(1)
  })

  it('F02：租约重领后拒绝旧写回，进度保持 80，旧执行者不能结算',async () => {
    const f = await fixture()
    await f.store.updateItem(f.bundle.job.id,0,{ provider_task_id: 'original',status: 'processing' })
    f.setNow(f.now() + 120_001)
    const newer = await f.claim()
    await advanceJobInStore(f.store,newer,f.runtime,{ alreadyLeased: true,outcomes: [{ ordinal: 0,patch: { status: 'processing',progress: 80 } }] })
    await advanceJobInStore(f.store,f.bundle,f.runtime,{ alreadyLeased: true,outcomes: [{ ordinal: 0,patch: { status: 'processing',progress: 10 } }] })
    expect((await f.store.listItems(f.bundle.job.id))[0].progress).toBe(80)
    expect(f.billing.settle).not.toHaveBeenCalled()
    expect(f.runtime.log).toHaveBeenCalledWith(expect.objectContaining({ stage: 'fence-rejected' }))
  })

  it.each(['TIMEOUT','UPSTREAM_UNAVAILABLE','BAD_RESPONSE'] as const)('%s 没有受理证据时保持 unknown，宽限内不补 POST，过后失败退款',async code => {
    const submit = vi.fn(async () => { throw new ProviderError(code,'响应不确定',true) })
    const f = await fixture(createMockImageProvider({ submit }))
    const submitted = await advanceImageClaim(f.bundle,f.runtime,true)
    expect(submitted.items[0].submission_state).toBe('unknown')
    f.setNow(f.now() + 60_000)
    await advanceImageClaim(await f.claim(),f.runtime)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(f.billing.release).not.toHaveBeenCalled()
    f.setNow(f.now() + 20_000)
    const failed = await advanceImageClaim(await f.claim(),f.runtime)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(failed.job.status).toBe('failed')
    expect(failed.job.error_code).toBe(code)
    expect(failed.job.billing_state).toBe('released')
    expect(failed.items[0].provider_task_id).toBeNull()
    expect(f.billing.release).toHaveBeenCalledTimes(1)
    expect(f.billing.settle).not.toHaveBeenCalled()
    expect(f.billing.reserve).toHaveBeenCalledTimes(1)
  })

  it('明确的 502/503 在请求内退避重提，仍失败则立刻退款且不再补 POST',async () => {
    const submit = vi.fn(async () => {
      const error = new ProviderError('UPSTREAM_UNAVAILABLE','图片服务暂时不可用，请稍后重试',true,502)
      error.definiteNotAccepted = true
      throw error
    })
    const f = await fixture(createMockImageProvider({ submit }))
    const sleep = vi.fn(async () => undefined)
    f.runtime.sleep = sleep
    const failed = await advanceImageClaim(f.bundle,f.runtime,true)
    expect(submit).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenNthCalledWith(1,1000)
    expect(sleep).toHaveBeenNthCalledWith(2,2000)
    expect(failed.job).toMatchObject({ status: 'failed',billing_state: 'released',error_code: 'UPSTREAM_UNAVAILABLE' })
    expect(failed.items[0].provider_task_id).toBeNull()
    expect(f.billing.release).toHaveBeenCalledTimes(1)
    expect(f.billing.settle).not.toHaveBeenCalled()
    expect(f.billing.reserve).toHaveBeenCalledTimes(1)
    f.setNow(f.now() + 60_000)
    await advanceImageClaim(await f.claim(),f.runtime)
    expect(submit).toHaveBeenCalledTimes(3)
    expect(f.billing.release).toHaveBeenCalledTimes(1)
  })

  it('503 重试成功只保留一次预扣，不会退款',async () => {
    const submit = vi.fn()
      .mockImplementationOnce(async () => {
        const error = new ProviderError('UPSTREAM_UNAVAILABLE','unavailable',true,503)
        error.definiteNotAccepted = true
        throw error
      })
      .mockResolvedValue({ providerTaskId: 'original' })
    const f = await fixture(createMockImageProvider({ submit }))
    const result = await advanceImageClaim(f.bundle,f.runtime,true)
    expect(submit).toHaveBeenCalledTimes(2)
    expect(result.items[0].provider_task_id).toBe('original')
    expect(result.items[0].submission_state).toBe('accepted')
    expect(f.billing.release).not.toHaveBeenCalled()
    expect(f.billing.settle).not.toHaveBeenCalled()
    expect(f.billing.reserve).toHaveBeenCalledTimes(1)
  })

  it('504 与客户端超时不重提，宽限前不退款',async () => {
    const submit = vi.fn(async () => { throw new ProviderError('TIMEOUT','图片服务请求超时，请稍后重试',true,504) })
    const f = await fixture(createMockImageProvider({ submit }))
    const held = await advanceImageClaim(f.bundle,f.runtime,true)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(held.items[0].submission_state).toBe('unknown')
    expect(held.job.billing_state).toBe('reserved')
    expect(f.billing.release).not.toHaveBeenCalled()
    const reset = vi.fn(async () => { throw new TypeError('fetch failed') })
    const resetFixture = await fixture(createMockImageProvider({ submit: reset }))
    const uncertain = await advanceImageClaim(resetFixture.bundle,resetFixture.runtime,true)
    expect(reset).toHaveBeenCalledTimes(1)
    expect(uncertain.items[0].submission_state).toBe('unknown')
    expect(resetFixture.billing.release).not.toHaveBeenCalled()
  })

  it('确知未发送才申请新尝试，复用原任务与预扣',async () => {
    const submit = vi.fn().mockImplementationOnce(async () => {
      const error = new ProviderError('UPSTREAM_UNAVAILABLE','未连接',true); error.requestSent = false; throw error
    }).mockResolvedValue({ providerTaskId: 'original' })
    const f = await fixture(createMockImageProvider({ submit }))
    await advanceImageClaim(f.bundle,f.runtime,true)
    f.setNow(f.now() + 60_000)
    const result = await advanceImageClaim(await f.claim(),f.runtime)
    expect(result.items[0].provider_task_id).toBe('original')
    expect((await f.store.listAttempts(f.bundle.job.id)).filter(attempt => attempt.kind === 'submit')).toHaveLength(2)
    expect(f.billing.reserve).toHaveBeenCalledTimes(1)
  })

  it('过期执行者只补提交回执，新持有者接续原编号，不再提交',async () => {
    let finish!: () => void
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const submit = vi.fn(async () => { entered(); await new Promise<void>(resolve => { finish = resolve }); return { providerTaskId: 'late-receipt' } })
    const f = await fixture(createMockImageProvider({ submit }))
    const original = advanceImageClaim(f.bundle,f.runtime,true)
    await started
    f.setNow(f.now() + 120_001)
    const newer = await f.claim()
    finish()
    await original
    expect((await f.store.listItems(f.bundle.job.id))[0].provider_task_id).toBeNull()
    const result = await advanceImageClaim(newer,f.runtime)
    expect(result.items[0].provider_task_id).toBe('late-receipt')
    expect(result.job.status).toBe('succeeded')
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('R2 已成功但最终数据库写回失败，下轮核验已有对象，不重复下载或生成',async () => {
    const submit = vi.fn(async () => ({ providerTaskId: 'original' }))
    const fetchResult = vi.fn(async () => ({ bytes: MOCK_PNG_1X1,mimeType: 'image/png' }))
    const f = await fixture(createMockImageProvider({ submit,fetchResult }))
    await advanceImageClaim(f.bundle,f.runtime,true)
    f.setNow(f.now() + 60_000)
    const claimed = await f.claim()
    const update = vi.spyOn(f.store,'updateItem').mockImplementationOnce(async () => { throw new Error('数据库写回失败') })
    // 第一次 reconcile 没有补丁，失败发生在最终结果写回。
    await expect(advanceImageClaim(claimed,f.runtime)).rejects.toThrow('数据库写回失败')
    expect((await f.store.listAttempts(claimed.job.id)).filter(attempt => attempt.kind === 'transfer').map(attempt => attempt.outcome)).toEqual([null])
    update.mockRestore()
    f.setNow(f.now() + 120_001)
    const result = await advanceImageClaim(await f.claim(),f.runtime)
    expect(result.job.status).toBe('succeeded')
    expect(fetchResult).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(f.objects.size).toBe(1)
    expect(f.billing.settle).toHaveBeenCalledTimes(1)
    expect((await f.store.listAttempts(claimed.job.id)).filter(attempt => attempt.kind === 'transfer').map(attempt => attempt.outcome)).toEqual(['accepted'])
  })

  it.each(['mime', 'checksum'])('恢复对象的 %s 不符时不发布，也不确认转存成功', async mismatch => {
    const getStatus = vi.fn().mockResolvedValueOnce({ state: 'succeeded', resultUrls: ['https://mock.local/0.png'] })
      .mockResolvedValue({ state: 'processing' })
    const f = await fixture(createMockImageProvider({ getStatus }))
    await advanceImageClaim(f.bundle, f.runtime, true)
    f.setNow(f.now() + 60_000)
    const claimed = await f.claim()
    const update = vi.spyOn(f.store, 'updateItem').mockRejectedValueOnce(new Error('模拟发布前崩溃'))
    await expect(advanceImageClaim(claimed, f.runtime)).rejects.toThrow('模拟发布前崩溃')
    update.mockRestore()
    const [key, object] = [...f.objects][0]
    f.objects.set(key, mismatch === 'mime' ? { ...object, contentType: 'image/jpeg' } : { ...object, bytes: new Uint8Array([0]) })
    f.setNow(f.now() + 120_001)
    const result = await advanceImageClaim(await f.claim(), f.runtime)
    expect(result.items[0].result_object_key).toBeNull()
    expect((await f.store.listAttempts(claimed.job.id)).filter(attempt => attempt.kind === 'transfer').map(attempt => attempt.outcome)).toEqual([null])
    expect(f.billing.settle).not.toHaveBeenCalled()
  })

  it('历史无编号无协议的明细只变 unknown，绝不补提交',async () => {
    const submit = vi.fn(async () => ({ providerTaskId: 'should-not-send' }))
    const f = await fixture(createMockImageProvider({ submit }))
    await f.store.updateItem(f.bundle.job.id,0,{ submission_state: null,submission_attempt_id: null })
    const result = await advanceImageClaim(f.bundle,f.runtime)
    expect(result.items[0].submission_state).toBe('unknown')
    expect(submit).not.toHaveBeenCalled()
  })

  it('截止前已有一张入库时只结算一张，迟到补图不再扣费',async () => {
    let late = false
    const provider = createMockImageProvider({
      submit: async input => ({ providerTaskId: `original-${input.ordinal}` }),
      getStatus: async id => id.endsWith('-1') && !late ? { state: 'processing' } : { state: 'succeeded',resultUrls: [`https://mock.local/${id}.png`] },
    })
    const f = await fixture(provider,2)
    await advanceImageClaim(f.bundle,f.runtime,true)
    f.setNow(f.now() + 60_000)
    const partial = await advanceImageClaim(await f.claim(),f.runtime)
    expect(partial.items.filter(item => item.result_object_key)).toHaveLength(1)
    expect(f.billing.settle).not.toHaveBeenCalled()
    late = true
    f.setNow(f.now() + 300_000)
    const completed = await advanceImageClaim(await f.claim(),f.runtime)
    expect(completed.items.filter(item => item.result_object_key)).toHaveLength(2)
    expect(completed.job.credits_charged).toBe(1)
    expect(completed.job.warnings).toContain('LATE_RESULT_NO_CHARGE')
    expect(f.billing.settle).toHaveBeenCalledTimes(1)
    expect(f.billing.settle).toHaveBeenCalledWith({ jobId: f.bundle.job.id,charged: 1 })
    expect(f.billing.release).not.toHaveBeenCalled()
  })

  it('批量补收按原序号取图，单张下载失败后不会把同一批供应商成本累计两次',async () => {
    const fetched: string[] = []
    let failSecond = true
    const submit = vi.fn(async () => ({ providerTaskId: 'batch-original' }))
    const provider = createMockImageProvider({
      submit,
      getStatus: async () => ({ state: 'succeeded',resultUrls: ['https://mock.local/0.png','https://mock.local/1.png'],
        vendor: { cost: 0.5,currency: 'USD',outputImageCount: 2 } }),
      fetchResult: async url => {
        fetched.push(url)
        if (url.endsWith('/1.png') && failSecond) throw new ProviderError('UPSTREAM_UNAVAILABLE','下载中断',true)
        return { bytes: MOCK_PNG_1X1,mimeType: 'image/png' }
      },
    })
    const f = await fixture(provider,2)
    await f.store.updateJob(f.bundle.job.id,{ provider_params: { ...f.bundle.job.provider_params,batch: true,n: 2 } })
    const original = { job: (await f.store.findById(f.bundle.job.id))!,items: f.bundle.items }
    await advanceImageClaim(original,f.runtime,true)
    f.setNow(f.now() + 60_000)
    const partial = await advanceImageClaim(await f.claim(),f.runtime)
    expect(partial.items[0].result_object_key).toBeTruthy()
    expect(partial.items[1].result_object_key).toBeNull()
    failSecond = false
    f.setNow(f.now() + 60_000)
    const completed = await advanceImageClaim(await f.claim(),f.runtime)
    expect(completed.items.every(item => item.result_object_key)).toBe(true)
    expect(fetched).toEqual(['https://mock.local/0.png','https://mock.local/1.png','https://mock.local/1.png'])
    expect(completed.job.provider_params.vendor).toMatchObject({ cost: 0.5,items: { '0': { output_image_count: 2 } } })
    expect(submit).toHaveBeenCalledTimes(1)
    expect(f.billing.settle).toHaveBeenCalledTimes(1)
    expect(completed.job.credits_charged).toBe(2)
  })

  it('验收 Mock 在正式执行身份下拒绝提交，不会消耗供应商请求',async () => {
    const submit = vi.fn(async () => ({ providerTaskId: '禁止' }))
    const f = await fixture(createMockImageProvider({ submit }))
    const provider = createMockImageProvider({ submit })
    await expect(provider.submit!({ model: 'mock',prompt: '测试',images: [],providerParams: {} },{
      fetch: f.runtime.fetch,sleep: f.runtime.sleep,now: f.runtime.now,log: f.runtime.log,
      execution: { scope: 'production',userId: user.id,jobId: f.bundle.job.id,attemptId: randomUUID() },
    })).rejects.toMatchObject({ code: 'INVALID_PARAMS',requestSent: false })
    expect(submit).not.toHaveBeenCalled()
  })

  it('预算不足不启动 POST，不留下 sending 意图，允许下一轮领取',async () => {
    const submit = vi.fn(async () => ({ providerTaskId: 'original' }))
    const f = await fixture(createMockImageProvider({ submit }))
    const result = await advanceImageClaim(f.bundle,{ ...f.runtime,budgetUntil: f.now() + 5_000 },true)
    expect(submit).not.toHaveBeenCalled()
    expect(result.items[0].submission_state).toBe('not_sent')
    expect(result.job.lease_token).toBeNull()
    expect(await f.claim()).toBeTruthy()
  })

  it('提交凭据不保存上游回显的提示词、签名地址、图片数据或密钥',async () => {
    const submit = vi.fn(async () => { throw new ProviderError('BAD_RESPONSE',
      '私有提示词 https://r2.test/image?token=secret data:image/png;base64,QUFB Bearer private-secret',false) })
    const f = await fixture(createMockImageProvider({ submit }))
    await advanceImageClaim(f.bundle,f.runtime,true)
    const attempts = JSON.stringify(await f.store.listAttempts(f.bundle.job.id))
    for (const secret of ['私有提示词','r2.test','token=secret','QUFB','private-secret']) expect(attempts).not.toContain(secret)
    expect((await f.store.listItems(f.bundle.job.id))[0].error_message).not.toContain('QUFB')
  })
})
