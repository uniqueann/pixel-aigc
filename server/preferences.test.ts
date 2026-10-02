import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultPreferences } from '../shared/preferences'

const mocks = vi.hoisted(() => ({
  rows: new Map<string, { preferences: unknown; updated_at: string }>(), active: true,
  sql: vi.fn(),
}))
vi.mock('./db', () => ({
  runtimeScope: () => 'production',
  withIdentity: async (_id: string, _email: string, action: (sql: unknown) => Promise<unknown>) => action(Object.assign(mocks.sql, { json: (value: unknown) => value })),
}))
import { handlePreferencesRoute } from './preferences'
const user = { id: 'alice', email: 'alice@example.com', providers: ['email'], avatarUrl: null, suggestedName: '测试账号' }
beforeEach(() => {
  mocks.rows.clear(); mocks.active = true; mocks.sql.mockReset()
  mocks.sql.mockImplementation(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const query = parts.join('?')
    if (query.includes('select status')) return [{ status: mocks.active ? 'active' : 'disabled' }]
    const key = `${values[0]}:${values[1]}`
    if (query.includes('select preferences,updated_at')) { const row = mocks.rows.get(key); return row ? [structuredClone(row)] : [] }
    if (query.includes('insert into aigc.user_preferences')) {
      const row = { preferences: structuredClone(values[2]), updated_at: '2026-10-02T10:00:00.000Z' }
      mocks.rows.set(key, row); return [row]
    }
    return []
  })
})

describe('个性化服务接口', () => {
  it('无记录时返回默认值和未存档状态，读取不执行写入', async () => {
    const result = await handlePreferencesRoute(user, 'GET', ['preferences'], undefined)
    expect(result).toEqual({ preferences: defaultPreferences(), hasStoredPreferences: false, updatedAt: null })
    expect(mocks.rows.size).toBe(0)
  })
  it('按字段合并，保留另一次请求修改的参数', async () => {
    await handlePreferencesRoute(user, 'PATCH', ['preferences'], { patches: [{ email: { language: 'en' } }] })
    const result = await handlePreferencesRoute(user, 'PATCH', ['preferences'], { patches: [{ image: { counts: { variation: 4 } } }] })
    expect(result.preferences.email.language).toBe('en')
    expect(result.preferences.image.counts.variation).toBe(4)
    expect(mocks.sql.mock.calls.some(call => call[0].join('').includes('pg_advisory_xact_lock'))).toBe(true)
    expect(mocks.sql.mock.calls.some(call => call[0].join('').includes('for update'))).toBe(true)
  })
  it('初始化只创建不存在记录，旧设备导入不会覆盖云端配置', async () => {
    await handlePreferencesRoute(user, 'PATCH', ['preferences'], { patches: [{ email: { language: 'ja' } }] })
    const result = await handlePreferencesRoute(user, 'PATCH', ['preferences'], { patches: [{ email: { language: 'en' } }], initializeOnly: true })
    expect(result.preferences.email.language).toBe('ja')
    expect(result.hasStoredPreferences).toBe(true)
  })
  it('清除及后续参数依次合并，恢复默认保持已初始化状态', async () => {
    await handlePreferencesRoute(user, 'PATCH', ['preferences'], { patches: [{ image: { lastUsed: { variation: { count: 4 } } } }] })
    const cleared = await handlePreferencesRoute(user, 'PATCH', ['preferences'], { patches: [{ image: { lastUsed: null } }, { image: { lastUsed: { relight: { count: 3 } } } }] })
    expect(cleared.preferences.image.lastUsed).toEqual({ relight: { count: 3 } })
    const reset = await handlePreferencesRoute(user, 'POST', ['preferences', 'reset'], undefined)
    expect(reset.preferences).toEqual(defaultPreferences()); expect(reset.hasStoredPreferences).toBe(true)
  })
  it('拒绝伪造账号、上传文件字段及非法枚举', async () => {
    for (const patch of [{ userId: 'bob' }, { image: { lastUsed: { watermark: { logo: 'file' } } } }, { email: { language: 'xx' } }]) {
      await expect(handlePreferencesRoute(user, 'PATCH', ['preferences'], { patches: [patch] })).rejects.toThrow()
    }
    expect(mocks.sql).not.toHaveBeenCalled()
  })
  it('停用账号不能读取配置，未开放方法不进入数据库', async () => {
    mocks.active = false
    await expect(handlePreferencesRoute(user, 'GET', ['preferences'], undefined)).rejects.toMatchObject({ status: 403 })
    expect(mocks.sql).toHaveBeenCalledTimes(1)
    mocks.sql.mockClear()
    await expect(handlePreferencesRoute(user, 'DELETE', ['preferences'], undefined)).rejects.toMatchObject({ status: 404 })
    expect(mocks.sql).not.toHaveBeenCalled()
  })
})
