import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { CloudError } from '@/cloud/client'
import { submitSuiteOnce } from './recovery'
import { clearPendingSuite, readPendingSuite } from './backup'
import { suiteQuoteSchema, suiteBatchSchema } from '@shared/ecommerce-suite'
import type { SuiteClient } from './api'
const fixture = JSON.parse(readFileSync('docs/verification/ecommerce-suite/phase-one/contract-fixtures.json', 'utf8'))
const quote = suiteQuoteSchema.parse(fixture.quote)
const batch = suiteBatchSchema.parse(fixture.batch)
const actor = batch.actor
const client = () => ({ assertCurrent: vi.fn(), submit: vi.fn(), findBatch: vi.fn() })
describe('单槽位提交恢复', () => {
  beforeEach(() => clearPendingSuite(actor, quote.projectId))
  it('响应丢失后只查原编号，找到原批次不再次 POST', async () => {
    const api = client(); api.submit.mockRejectedValue(new TypeError('连接断开')); api.findBatch.mockResolvedValue(batch)
    expect(await submitSuiteOnce(api as unknown as SuiteClient, actor, quote.projectId, quote)).toEqual(batch)
    expect(api.submit).toHaveBeenCalledTimes(1)
    expect(api.findBatch).toHaveBeenCalledWith(quote.projectId, api.submit.mock.calls[0][1])
    expect(await readPendingSuite(actor, quote.projectId)).toBeUndefined()
  })
  it('查不到提交事实时保留原编号，重新打开仍能查询', async () => {
    const api = client(); api.submit.mockRejectedValue(new TypeError('连接断开')); api.findBatch.mockResolvedValue(null)
    await expect(submitSuiteOnce(api as unknown as SuiteClient, actor, quote.projectId, quote)).rejects.toThrow('提交结果待确认')
    const pending = await readPendingSuite(actor, quote.projectId)
    expect(pending?.requestId).toBe(api.submit.mock.calls[0][1])
    expect(api.submit).toHaveBeenCalledTimes(1)
  })
  it('明确回滚的费用错误不会自动重试或写入新请求', async () => {
    const api = client(); api.submit.mockRejectedValue(new CloudError(402, '余额不足', 'INSUFFICIENT_CREDITS'))
    await expect(submitSuiteOnce(api as unknown as SuiteClient, actor, quote.projectId, quote)).rejects.toMatchObject({ status: 402 })
    expect(api.findBatch).not.toHaveBeenCalled()
    expect(api.submit).toHaveBeenCalledTimes(1)
    expect(await readPendingSuite(actor, quote.projectId)).toBeUndefined()
  })
  it('账号变化时保留旧账号凭据，不给新账号补发查询或任务', async () => {
    const api = client(); api.assertCurrent.mockImplementationOnce(() => undefined).mockImplementationOnce(() => undefined).mockImplementation(() => { throw new CloudError(401, '账号变化', 'ACCOUNT_CHANGED') })
    api.submit.mockRejectedValue(new TypeError('连接断开'))
    await expect(submitSuiteOnce(api as unknown as SuiteClient, actor, quote.projectId, quote)).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' })
    expect(api.findBatch).not.toHaveBeenCalled()
    expect(await readPendingSuite(actor, quote.projectId)).toBeDefined()
    expect(await readPendingSuite({ ...actor, runtimeScope: actor.runtimeScope === 'local' ? 'preview' : 'local' }, quote.projectId)).toBeUndefined()
  })
  it('按钮连点并发进入时合并为同一次提交', async () => {
    const api = client(); api.submit.mockResolvedValue(batch)
    const values = await Promise.all([submitSuiteOnce(api as unknown as SuiteClient, actor, quote.projectId, quote), submitSuiteOnce(api as unknown as SuiteClient, actor, quote.projectId, quote)])
    expect(values).toEqual([batch, batch])
    expect(api.submit).toHaveBeenCalledTimes(1)
  })
  it('本机已有未知提交时拒绝创建第二次尝试', async () => {
    const api = client(); api.submit.mockRejectedValue(new TypeError('响应丢失')); api.findBatch.mockResolvedValue(null)
    await expect(submitSuiteOnce(api as unknown as SuiteClient, actor, quote.projectId, quote)).rejects.toThrow()
    await expect(submitSuiteOnce(api as unknown as SuiteClient, actor, quote.projectId, quote)).rejects.toThrow('已有待确认')
    expect(api.submit).toHaveBeenCalledTimes(1)
  })
})
