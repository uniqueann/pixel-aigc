import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import type { SuiteUser } from './repository.js'

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  calls: [] as string[],
  readSuite: vi.fn(),
}))

vi.mock('./repository.js', () => ({
  suiteTransaction: (_user: unknown, action: (sql: (strings: TemplateStringsArray, ...values: unknown[]) => unknown[]) => Promise<unknown>) =>
    action((strings) => {
      const text = Array.from(strings).join(' ')
      state.calls.push(text)
      if (text.includes('pg_advisory_xact_lock')) return []
      if (text.includes('from aigc.suite_projects where create_request_id=')) return state.rows
      return []
    }),
  actor: (user: { id: string }) => ({ userId: user.id, runtimeScope: 'local' as const }),
  fingerprint: () => 'fp',
  readSuite: (...args: unknown[]) => state.readSuite(...args),
  requireSuite: async () => ({}),
  toSuiteAsset: (row: unknown) => row,
  validateTemplate: () => undefined,
  assertRevision: () => undefined,
}))

import { createSuite } from './projects.js'

const fixture = JSON.parse(readFileSync('docs/verification/ecommerce-suite/phase-one/contract-fixtures.json', 'utf8'))
const user = {
  id: fixture.project.actor.userId,
  email: 'fixture@example.invalid',
  suggestedName: '测试',
  avatarUrl: null,
  providers: [],
} as SuiteUser
const request = fixture.createProject

describe('创建套图项目的删除凭据', () => {
  beforeEach(() => {
    state.rows = []
    state.calls = []
    state.readSuite.mockReset()
  })

  it('同一请求命中的项目已删除时返回可恢复错误，而不是 404', async () => {
    state.rows = [{ id: 'project', request_fingerprint: 'fp', deleted_at: '2026-01-01T00:00:00Z', purge_started_at: null }]
    await expect(createSuite(user, request)).rejects.toMatchObject({ status: 409, code: 'SUITE_PROJECT_DELETED' })
    expect(state.readSuite).not.toHaveBeenCalled()
  })

  it('项目仍存在时按原请求找回项目', async () => {
    state.rows = [{ id: 'project', request_fingerprint: 'fp', deleted_at: null, purge_started_at: null }]
    state.readSuite.mockResolvedValue({ id: 'project' })
    await expect(createSuite(user, request)).resolves.toEqual({ id: 'project' })
    expect(state.readSuite).toHaveBeenCalledTimes(1)
  })

  it('同一请求对应不同配置时仍返回冲突', async () => {
    state.rows = [{ id: 'project', request_fingerprint: 'other', deleted_at: null, purge_started_at: null }]
    await expect(createSuite(user, request)).rejects.toMatchObject({ status: 409, code: 'SUITE_REQUEST_CONFLICT' })
    expect(state.readSuite).not.toHaveBeenCalled()
  })
})
