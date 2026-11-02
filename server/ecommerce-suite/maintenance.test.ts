import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ calls: [] as string[], lockAt: -1, requireAt: -1 }))

vi.mock('./repository.js', () => ({
  suiteTransaction: (_user: unknown, action: (sql: (strings: TemplateStringsArray, ...values: unknown[]) => unknown[]) => Promise<unknown>) =>
    action((strings) => {
      const text = Array.from(strings).join(' ')
      state.calls.push(text)
      if (text.includes('pg_advisory_xact_lock')) state.lockAt = state.calls.length - 1
      return []
    }),
  requireSuite: async () => {
    state.requireAt = state.calls.length
    throw new Error('stop-after-lock-order')
  },
  actor: (user: { id: string }) => ({ userId: user.id, runtimeScope: 'local' as const }),
  fingerprint: () => 'fp',
  readSuite: async () => ({}),
  readyAsset: async () => ({}),
  assertRevision: () => undefined,
  toSuiteAsset: (row: unknown) => row,
  validateTemplate: () => undefined,
}))

import { dispatchSuiteClaim } from './maintenance.js'

describe('套图派发锁顺序', () => {
  it('先取全局计费锁，再锁项目行，避免与普通任务创建互相等待', async () => {
    state.calls = []
    state.lockAt = -1
    state.requireAt = -1
    const claim = {
      id: '11111111-1111-4111-8111-111111111111',
      user_id: '22222222-2222-4222-8222-222222222222',
      project_id: '33333333-3333-4333-8333-333333333333',
      batch_id: '44444444-4444-4444-8444-444444444444',
      lease_token: '55555555-5555-4555-8555-555555555555',
    }

    await expect(dispatchSuiteClaim(claim)).rejects.toThrow('stop-after-lock-order')

    // 普通任务创建是“全局计费锁 → 项目行锁”；套图派发必须保持同一顺序。
    expect(state.calls[0]).toContain('pg_advisory_xact_lock(91517002)')
    expect(state.lockAt).toBe(0)
    expect(state.requireAt).toBe(1)
  })
})
