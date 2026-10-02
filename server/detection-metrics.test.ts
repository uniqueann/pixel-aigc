import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withSyncLimit, type SyncRequestMetrics } from './sync-limits'
import { HttpError } from './errors'
const mocks = vi.hoisted(() => ({ sql: vi.fn() }))
vi.mock('./model-settings', () => ({ requireActive: async () => undefined }))
vi.mock('./db', () => ({
  runtimeScope: () => 'preview',
  withIdentity: async (_id: string, _email: string, action: (sql: unknown) => Promise<unknown>) => action(Object.assign(mocks.sql, { json: (value: unknown) => value })),
}))
describe('检测性能记录写入', () => {
  beforeEach(() => { mocks.sql.mockReset().mockResolvedValue([{ hourly: 0, active: 0 }]) })
  it.each([200, 422, 504])('成功或失败均保存状态 %s 和已完成阶段', async status => {
    const metrics: SyncRequestMetrics = { route: 'smart-select', requestId: 'request-id', transport: 'inline', inputBytes: 123, maskBytes: 0, outputBytes: 42, stageMs: {} }
    const operation = withSyncLimit({ id: 'owner', email: 'test@example.com' }, 'detection', async () => {
      metrics.stageMs.cacheLookup = 2
      if (status !== 200) throw new HttpError(status, '测试错误', 'TEST_FAILURE')
      return 'ok'
    }, metrics)
    if (status === 200) await expect(operation).resolves.toBe('ok')
    else await expect(operation).rejects.toMatchObject({ status })
    const update = mocks.sql.mock.calls.find(([parts]) => parts.join('').includes('update aigc.sync_requests'))!
    expect(update[1]).toBe(status)
    expect(update.slice(3, 7)).toEqual([123, 0, 42, { cacheLookup: 2 }])
  })
  it('200 miss 仍写入 error_code 以便区分未点中', async () => {
    const metrics: SyncRequestMetrics = { route: 'smart-select', requestId: 'request-id', transport: 'inline', inputBytes: 80, maskBytes: 0, outputBytes: 64, errorCode: 'SMART_SELECT_MISS', stageMs: { cacheLookup: 1 } }
    await expect(withSyncLimit({ id: 'owner', email: 'test@example.com' }, 'detection', async () => 'ok', metrics)).resolves.toBe('ok')
    const update = mocks.sql.mock.calls.find(([parts]) => parts.join('').includes('update aigc.sync_requests'))!
    expect(update[1]).toBe(200)
    expect(update[2]).toBe('SMART_SELECT_MISS')
    expect(update.slice(3, 7)).toEqual([80, 0, 64, { cacheLookup: 1 }])
  })
})

