import { describe, expect, it, vi } from 'vitest'
import { measureImagePhase, observeImagePollHint } from './metrics.js'

const job = { id: 'job', request_id: 'request', provider: 'bailian', model_profile_id: 'bailian:qwen-image-3.0', scope: 'preview' as const }
describe('图片任务分段观测', () => {
  it('记录响应实际提示，终态不记录，观测异常不改变响应', () => {
    const runtime = { now: () => 0, log: vi.fn() }
    observeImagePollHint(runtime, job, 3_000)
    observeImagePollHint(runtime, job, undefined)
    expect(runtime.log).toHaveBeenCalledTimes(1)
    expect(runtime.log).toHaveBeenCalledWith({ evt: 'image-job-poll-hint', jobId: 'job', requestId: 'request',
      provider: 'bailian', modelProfileId: 'bailian:qwen-image-3.0', scope: 'preview', pollAfterMs: 3_000 })
    runtime.log.mockImplementation(() => { throw new Error('观测失败') })
    expect(() => observeImagePollHint(runtime, job, 1_000)).not.toThrow()
  })
  it('返回原结果并记录完整异步阶段，日志不读取业务结果', async () => {
    let now = 0
    const runtime = { now: () => now, log: vi.fn() }
    const result = { url: 'https://private.test/?secret=1', prompt: '私有提示词' }
    await expect(measureImagePhase(runtime, job, 'download', async () => { now = 125; return result }, { ordinal: 0 })).resolves.toBe(result)
    expect(runtime.log).toHaveBeenCalledWith(expect.objectContaining({ evt: 'image-job-phase', ms: 125, outcome: 'success', ordinal: 0 }))
    expect(JSON.stringify(runtime.log.mock.calls)).not.toMatch(/private\.test|secret|私有提示词/)
  })
  it('失败保留原异常，指标异常也不改变业务返回', async () => {
    const error = new Error('含私有地址的异常')
    const runtime = { now: () => 100, log: vi.fn() }
    await expect(measureImagePhase(runtime, job, 'status', async () => { throw error })).rejects.toBe(error)
    expect(runtime.log).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }))
    expect(JSON.stringify(runtime.log.mock.calls)).not.toContain(error.message)
    runtime.log.mockImplementation(() => { throw new Error('观测失败') })
    await expect(measureImagePhase(runtime, job, 'store', async () => '原结果')).resolves.toBe('原结果')
  })
})
