import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import type { SuiteUser } from './repository.js'

const state = vi.hoisted(() => ({ readSuite: vi.fn(), readyAsset: vi.fn(), calls: [] as string[] }))

vi.mock('./repository.js', () => ({
  suiteTransaction: (_user: unknown, action: (sql: ((strings: TemplateStringsArray, ...values: unknown[]) => unknown[]) & { json: (value: unknown) => unknown }) => Promise<unknown>) =>
    action(Object.assign((strings: TemplateStringsArray) => { state.calls.push(Array.from(strings).join(' ')); return [] }, { json: (value: unknown) => value })),
  actor: (user: { id: string }) => ({ userId: user.id, runtimeScope: 'local' as const }),
  fingerprint: () => 'fp',
  readSuite: (...args: unknown[]) => state.readSuite(...args),
  requireSuite: async () => ({ revision: 0 }),
  readyAsset: (...args: unknown[]) => state.readyAsset(...args),
  validateTemplate: () => undefined,
}))

import { restoreSuiteSnapshot } from './restore.js'
import { HttpError } from '../errors.js'

const fixture = JSON.parse(readFileSync('docs/verification/ecommerce-suite/phase-one/contract-fixtures.json', 'utf8'))
const user = { id: fixture.project.actor.userId, email: 'fixture@example.invalid', suggestedName: '测试', avatarUrl: null, providers: [] } as SuiteUser
const projectId = '00000000-0000-4000-8000-000000000030'
const baseConfig = fixture.createProject.config
const mainSlot = baseConfig.slots[0]

let currentConfig = baseConfig

function request(overrides: Record<string, unknown> = {}) {
  const config = { ...baseConfig, facts: [] }
  const version = { id: crypto.randomUUID(), slotId: mainSlot.id, parentVersionId: null as string | null, assetId: config.baseAssetId,
    versionNumber: 1, composition: fixture.version.composition }
  return { requestId: crypto.randomUUID(), config, versions: [version],
    heads: config.slots.map((slot: { id: string }, index: number) => ({ slotId: slot.id, activeVersionId: index === 0 ? version.id : null })),
    drafts: [], ...overrides }
}

describe('恢复历史版本', () => {
  beforeEach(() => {
    state.calls = []
    state.readyAsset.mockReset()
    state.readyAsset.mockResolvedValue({})
    state.readSuite.mockReset()
    state.readSuite.mockImplementation(async () => ({ id: projectId, revision: 0, config: currentConfig }))
  })

  it('已删除的规格和平台切换后的历史图层不会阻断合法恢复包', async () => {
    // 当前配置已没有这些规格，且主图在 Amazon 下锁定图层；但历史版本是不可变快照，恢复不能回验。
    const body = request()
    currentConfig = body.config
    await expect(restoreSuiteSnapshot(user, projectId, body)).resolves.toBeDefined()
    expect(state.calls.some(text => text.includes('insert into aigc.suite_versions'))).toBe(true)
  })

  it('同一槽位重复版本号仍然拒绝', async () => {
    const body = request()
    body.versions = [body.versions[0], { ...body.versions[0], id: crypto.randomUUID() }]
    currentConfig = body.config
    await expect(restoreSuiteSnapshot(user, projectId, body)).rejects.toMatchObject({ code: 'SUITE_RESULT_CONFLICT' })
  })

  it('父版本指向其他槽位仍然拒绝', async () => {
    const body = request()
    const parent = body.versions[0]
    body.versions = [parent, { ...parent, id: crypto.randomUUID(), slotId: body.config.slots[1].id, parentVersionId: parent.id, versionNumber: 2 }]
    currentConfig = body.config
    await expect(restoreSuiteSnapshot(user, projectId, body)).rejects.toMatchObject({ code: 'SUITE_RESULT_CONFLICT' })
  })

  it('引用未就绪资产仍然拒绝', async () => {
    const body = request()
    currentConfig = body.config
    state.readyAsset.mockRejectedValue(new HttpError(404, '图片尚未持久保存', 'SUITE_ASSET_UNAVAILABLE'))
    await expect(restoreSuiteSnapshot(user, projectId, body)).rejects.toMatchObject({ code: 'SUITE_ASSET_UNAVAILABLE' })
  })
})
