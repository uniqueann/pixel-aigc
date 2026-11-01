import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ calls: [] as string[] }))

vi.mock('../ecommerce-suite/config.js', () => ({ ecommerceSuiteEnabled: () => true }))
vi.mock('../db.js', () => ({
  runtimeScope: () => 'local',
  withIdentity: async (_id: string, _email: string, action: (sql: unknown) => Promise<unknown>) => action(sql),
}))

/** 只记录 SQL 顺序；桥接查询返回空行，让校验在取锁之后报 404。 */
const sql = Object.assign((strings: TemplateStringsArray) => {
  const text = Array.from(strings).join(' ')
  state.calls.push(text)
  if (text.includes('aigc.members')) return Promise.resolve([{ status: 'active' }])
  return Promise.resolve([])
}, { json: (value: unknown) => value })

import { submitImageTask } from './service.js'

const user = { id: '00000000-0000-4000-8000-000000000001', email: 'alice@example.com', suggestedName: 'A', avatarUrl: null, providers: ['email'] }
const body = {
  capability: 'image_edit',
  requestId: '00000000-0000-4000-8000-000000000201',
  origin: { entry: 'workstation', tool: 'smart-edit', suiteBridgeId: '00000000-0000-4000-8000-000000000301' },
  params: { sourceImageKey: `temporary/task-inputs/${user.id}/source-1`, prompt: '换成白底', count: 1, resolution: '2k', sourceWidth: 1200, sourceHeight: 800 },
}

describe('桥接任务的加锁顺序', () => {
  beforeEach(() => { state.calls = [] })

  it('先取全局计费锁，再锁套图项目行，避免与套图派发反向加锁死锁', async () => {
    await expect(submitImageTask(user, body)).rejects.toMatchObject({ code: 'SUITE_NOT_FOUND' })
    const lock = state.calls.findIndex(text => text.includes('pg_advisory_xact_lock(91517002)'))
    const bridge = state.calls.findIndex(text => text.includes('aigc.suite_bridges'))
    expect(lock).toBeGreaterThanOrEqual(0)
    // 桥接查询带 for update of p，会把套图项目行锁住；它必须在全局锁之后。
    expect(bridge).toBeGreaterThan(lock)
  })
})
