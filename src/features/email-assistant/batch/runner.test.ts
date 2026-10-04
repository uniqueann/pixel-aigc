import { describe, expect, it, vi } from 'vitest'
import { Capability, type EmailAssistTaskParams, type GenerationTask } from '@/types'
import { createEmailBatchRunner } from './runner'
import type { EmailBatchRow } from './types'

const params: EmailAssistTaskParams = { sourceText: '客户邮件', operation: 'reply', language: 'zh' }
const task = (status: GenerationTask['status'] = 'succeeded', patch: Partial<GenerationTask<unknown>> = {}): GenerationTask<unknown> => ({
  id: 'email-task', capability: Capability.EmailAssist, status, params,
  resultText: status === 'succeeded' ? '生成结果' : undefined,
  creditsCost: 0, createdAt: '2026-10-04', updatedAt: '2026-10-04', ...patch,
})
const rows = (count = 2): EmailBatchRow[] => Array.from({ length: count }, (_, i) => ({
  id: `row-${i}`, recordNumber: i + 2, original: { 原始邮件内容: `客户邮件${i}`, 编写指导: '', 生成设置: '', 语言: '' },
  params: { ...params, sourceText: `客户邮件${i}` }, status: 'pending',
}))
function setup(data = rows()) {
  const ports = {
    submit: vi.fn().mockResolvedValue(task()), find: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(task()), wait: vi.fn().mockResolvedValue(undefined),
    acquire: vi.fn().mockReturnValue(true), release: vi.fn(), onTask: vi.fn(), onInvalidKey: vi.fn(),
  }
  const runner = createEmailBatchRunner(ports)
  runner.load(data, '邮件.csv')
  return { runner, ports }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('邮件批量串行队列', () => {
  it('一次只提交一条，重复开始不重复请求，整个批次固定默认模型', async () => {
    const { runner, ports } = setup()
    const first = deferred<GenerationTask<unknown>>()
    ports.submit.mockReturnValueOnce(first.promise)
    const running = runner.start('默认模型一')
    await runner.start('默认模型二')
    expect(ports.submit).toHaveBeenCalledTimes(1)
    expect(runner.getSnapshot().rows.map(row => row.status)).toEqual(['processing', 'pending'])
    first.resolve(task())
    await running
    expect(ports.submit).toHaveBeenCalledTimes(2)
    expect(ports.submit.mock.calls.every(([request]) => request.modelProfileId === '默认模型一')).toBe(true)
    expect(runner.getSnapshot().runState).toBe('completed')
    expect(runner.getSnapshot().rows.every(row => row.status === 'succeeded')).toBe(true)
  })

  it('暂停等待当前邮件完成，继续仅处理剩余行', async () => {
    const { runner, ports } = setup()
    const first = deferred<GenerationTask<unknown>>()
    ports.submit.mockReturnValueOnce(first.promise)
    const running = runner.start('默认模型')
    runner.pause()
    expect(runner.getSnapshot().runState).toBe('pausing')
    first.resolve(task())
    await running
    expect(ports.submit).toHaveBeenCalledTimes(1)
    expect(runner.getSnapshot().rows.map(row => row.status)).toEqual(['succeeded', 'pending'])
    await runner.start('修改后的模型')
    expect(ports.submit).toHaveBeenCalledTimes(2)
    expect(ports.submit.mock.calls[1][0].modelProfileId).toBe('默认模型')
  })

  it('跳过无效行，普通失败继续，失败重试生成新标识并保留成功行', async () => {
    const data = rows(3)
    data[2] = { ...data[2], status: 'invalid', params: undefined, errorMessage: '正文缺失' }
    const { runner, ports } = setup(data)
    ports.submit.mockResolvedValueOnce(task('failed', { id: '失败任务', errorCode: 'RESULT_TRUNCATED', errorMessage: '输出截断' }))
    await runner.start('默认模型')
    expect(runner.getSnapshot().rows.map(row => row.status)).toEqual(['failed', 'succeeded', 'invalid'])
    const originalRequest = ports.submit.mock.calls[0][0].requestId
    await runner.retry('默认模型')
    expect(ports.submit).toHaveBeenCalledTimes(3)
    expect(ports.submit.mock.calls[2][0].requestId).not.toBe(originalRequest)
    expect(runner.getSnapshot().rows.map(row => row.status)).toEqual(['succeeded', 'succeeded', 'invalid'])
  })

  it.each(['INVALID_PROVIDER_KEY', 'PROVIDER_BALANCE', 'PROVIDER_RATE_LIMIT'])('任务返回 %s 时暂停余下队列', async code => {
    const { runner, ports } = setup()
    ports.submit.mockResolvedValueOnce(task('failed', { errorCode: code, errorMessage: '需要处理配置' }))
    await runner.start('默认模型')
    expect(ports.submit).toHaveBeenCalledTimes(1)
    expect(runner.getSnapshot().rows.map(row => row.status)).toEqual(['failed', 'pending'])
    expect(runner.getSnapshot().runState).toBe('paused')
    expect(ports.onInvalidKey).toHaveBeenCalledTimes(code === 'INVALID_PROVIDER_KEY' ? 1 : 0)
  })

  it.each(['RATE_LIMIT', 'USER_CONCURRENCY', 'GLOBAL_CONCURRENCY', 'MODEL_KEY_INVALID'])('提交被 %s 拒绝时保留待处理行及原幂等键', async code => {
    const { runner, ports } = setup()
    ports.submit.mockRejectedValueOnce(Object.assign(new Error('服务限制'), { status: 429, code }))
    await runner.start('默认模型')
    const requestId = ports.submit.mock.calls[0][0].requestId
    expect(runner.getSnapshot().rows[0]).toMatchObject({ status: 'pending', requestId })
    expect(ports.submit).toHaveBeenCalledTimes(1)
    await runner.start('默认模型')
    expect(ports.submit.mock.calls[1][0].requestId).toBe(requestId)
  })

  it('响应丢失后找回原任务并轮询，进入终态前不提交下一行', async () => {
    const { runner, ports } = setup()
    ports.submit.mockRejectedValueOnce(new Error('网络超时'))
    ports.find.mockResolvedValueOnce(task('processing'))
    const poll = deferred<GenerationTask<unknown>>()
    ports.get.mockReturnValueOnce(poll.promise)
    const running = runner.start('默认模型')
    await vi.waitFor(() => expect(ports.get).toHaveBeenCalledTimes(1))
    expect(ports.submit).toHaveBeenCalledTimes(1)
    expect(ports.find).toHaveBeenCalledWith(ports.submit.mock.calls[0][0].requestId)
    poll.resolve(task())
    await running
    expect(ports.submit).toHaveBeenCalledTimes(2)
    expect(runner.getSnapshot().rows[0].resultText).toBe('生成结果')
  })

  it('查询失败后锁定待确认行，重新查询只读取原任务，不重新提交', async () => {
    const { runner, ports } = setup()
    ports.submit.mockResolvedValueOnce(task('processing'))
    ports.get.mockRejectedValueOnce(new Error('查询失败'))
    await runner.start('默认模型')
    expect(runner.getSnapshot().rows[0].status).toBe('uncertain')
    expect(ports.release).not.toHaveBeenCalled()
    await runner.start('默认模型')
    await runner.retry('默认模型')
    expect(ports.submit).toHaveBeenCalledTimes(1)
    expect(() => runner.load(rows())).toThrow('重新查询')
    await runner.recover()
    expect(ports.submit).toHaveBeenCalledTimes(1)
    expect(runner.getSnapshot().rows.map(row => row.status)).toEqual(['succeeded', 'pending'])
    expect(ports.release).toHaveBeenCalledTimes(1)
    await runner.start('默认模型')
    expect(ports.submit).toHaveBeenCalledTimes(2)
  })

  it('网络失败且原请求查询也失败时暂停，不擅自生成新请求', async () => {
    const { runner, ports } = setup()
    ports.submit.mockRejectedValueOnce(new Error('连接中断'))
    ports.find.mockRejectedValueOnce(new Error('无法查询'))
    await runner.start('默认模型')
    expect(runner.getSnapshot().rows[0].status).toBe('uncertain')
    const requestId = runner.getSnapshot().rows[0].requestId
    await runner.recover()
    expect(runner.getSnapshot().rows[0].status).toBe('pending')
    await runner.start('默认模型')
    expect(ports.submit.mock.calls[1][0].requestId).toBe(requestId)
  })

  it('没有找到原任务时保留幂等键并暂停，由用户继续', async () => {
    const { runner, ports } = setup()
    ports.submit.mockRejectedValueOnce(new Error('网络中断'))
    await runner.start('默认模型')
    expect(runner.getSnapshot().runState).toBe('paused')
    expect(runner.getSnapshot().rows[0].status).toBe('pending')
    expect(ports.submit).toHaveBeenCalledTimes(1)
  })

  it('接口成功却缺少正文时报告行失败', async () => {
    const { runner, ports } = setup(rows(1))
    ports.submit.mockResolvedValueOnce(task('succeeded', { resultText: ' ' }))
    await runner.start('默认模型')
    expect(runner.getSnapshot().rows[0]).toMatchObject({ status: 'failed', errorCode: 'RESULT_PROTOCOL' })
  })

  it('单个模式占用时不提交，解除后可继续', async () => {
    const { runner, ports } = setup()
    ports.acquire.mockReturnValueOnce(false)
    await runner.start('默认模型')
    expect(ports.submit).not.toHaveBeenCalled()
    expect(runner.getSnapshot().pauseMessage).toContain('当前有邮件')
    await runner.start('默认模型')
    expect(ports.submit).toHaveBeenCalledTimes(2)
  })

  it('页面销毁后不继续提交，也不写入迟到的账号任务响应', async () => {
    const { runner, ports } = setup()
    const first = deferred<GenerationTask<unknown>>()
    ports.submit.mockReturnValueOnce(first.promise)
    const running = runner.start('默认模型')
    runner.dispose()
    expect(ports.submit.mock.calls[0][1].aborted).toBe(true)
    const snapshot = runner.getSnapshot()
    first.resolve(task())
    await running
    expect(ports.submit).toHaveBeenCalledTimes(1)
    expect(ports.onTask).not.toHaveBeenCalled()
    expect(runner.getSnapshot()).toBe(snapshot)
  })
})
