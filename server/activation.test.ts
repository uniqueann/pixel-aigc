import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleActivationRoute } from './activation'
const mocks = vi.hoisted(() => ({ sql: vi.fn(), identity: vi.fn() }))
vi.mock('./db', () => ({ runtimeScope: () => 'local', withIdentity: mocks.identity }))
const user = { id: 'owner', email: 'owner@example.com', avatarUrl: null, suggestedName: '', providers: ['email'] }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.identity.mockImplementation((_id, _email, action) => action(mocks.sql))
  mocks.sql.mockImplementation(async (parts: TemplateStringsArray) => {
    const sql = parts.join('?')
    if (sql.includes('select status')) return [{ status: 'active' }]
    if (sql.includes('select delta')) return [{ delta: 30 }]
    if (sql.includes('as has_work')) return [{ has_work: false }]
    if (sql.includes('record_first_upload')) return [{ recorded: true }]
    return []
  })
})
describe('使用事件接口校验', () => {
  it('已验证账号读取实际赠送与欢迎状态', async () => {
    expect(await handleActivationRoute(user, 'GET', ['activation'], undefined)).toEqual({
      initialCredits: 30, creditNoticeSeen: false, starterCardDismissed: false, analyticsEnabled: true, hasCreatedWork: false,
    })
    expect(mocks.identity).toHaveBeenCalledWith(user.id, user.email, expect.any(Function))
  })
  it('只接收指定工具的首次上传，不能冒充注册、成功或另一个账号', async () => {
    expect(await handleActivationRoute(user, 'POST', ['activation', 'events'], { event: 'first_upload', tool: 'bg-remove' })).toEqual({ recorded: true })
    for (const body of [
      { event: 'registration_complete', tool: 'bg-remove' }, { event: 'first_generation_success', tool: 'bg-remove' },
      { event: 'first_upload', tool: 'unknown' }, { event: 'first_upload', tool: 'bg-remove', userId: 'other' },
      { event: 'first_upload', tool: 'bg-remove', prompt: '私密内容' },
    ]) await expect(handleActivationRoute(user, 'POST', ['activation', 'events'], body)).rejects.toThrow()
  })
  it('欢迎状态只允许关闭、已读与统计开关，不接受赠送金额或账号字段', async () => {
    for (const body of [{}, { initialCredits: 100 }, { userId: 'other' }, { creditNoticeSeen: false }, { hasCreatedWork: true }])
      await expect(handleActivationRoute(user, 'PATCH', ['activation'], body)).rejects.toThrow()
    await expect(handleActivationRoute(user, 'PATCH', ['activation'], { analyticsEnabled: false })).resolves.toBeTruthy()
  })
  it('没有活跃成员时拒绝记录，未知路由拒绝访问', async () => {
    mocks.sql.mockResolvedValue([{ status: 'disabled' }])
    await expect(handleActivationRoute(user, 'POST', ['activation', 'events'], { event: 'first_upload', tool: 'bg-remove' })).rejects.toMatchObject({ code: 'MEMBER_DISABLED' })
    await expect(handleActivationRoute(user, 'DELETE', ['activation'], undefined)).rejects.toMatchObject({ status: 404 })
  })
})
