// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ session: vi.fn(), fetch: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getSession: mocks.session } }) }))
let client: typeof import('./client')
const session = (id: string) => ({ data: { session: { user: { id }, access_token: '受控测试令牌' } } })
beforeEach(async () => {
  vi.resetModules()
  vi.stubEnv('VITE_AUTH_MODE', 'enabled'); vi.stubEnv('VITE_CLOUD_MODE', 'enabled')
  vi.stubEnv('VITE_AIGC_SUPABASE_URL', 'https://example.invalid'); vi.stubEnv('VITE_AIGC_SUPABASE_PUBLISHABLE_KEY', '受控测试公钥')
  mocks.session.mockReset().mockResolvedValue(session('甲'))
  mocks.fetch.mockReset().mockImplementation(async () => Response.json({ items: [] }))
  vi.stubGlobal('fetch', mocks.fetch)
  client = await import('./client')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('首页云请求账号与取消检查', () => {
  it('请求前换号或取消时不会发出网络请求', async () => {
    mocks.session.mockResolvedValueOnce(session('乙'))
    await expect(client.cloudRequest('/projects', 'GET', undefined, { expectedUserId: '甲' })).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' })
    const controller = new AbortController(); controller.abort(new Error('取消读取'))
    await expect(client.cloudRequest('/projects', 'GET', undefined, { expectedUserId: '甲', signal: controller.signal })).rejects.toThrow('取消读取')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('响应到达后再次检查会话，旧账号结果不返回给调用方', async () => {
    mocks.session.mockResolvedValueOnce(session('甲')).mockResolvedValueOnce(session('乙'))
    await expect(client.cloudRequest('/projects', 'GET', undefined, { expectedUserId: '甲' })).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('响应期间取消时即便受控网络返回数据也不会接受', async () => {
    const controller = new AbortController()
    mocks.fetch.mockImplementationOnce(async () => { controller.abort(new Error('取消读取')); return Response.json({ items: [] }) })
    await expect(client.cloudRequest('/projects', 'GET', undefined, { expectedUserId: '甲', signal: controller.signal })).rejects.toThrow('取消读取')
    expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(true)
  })
})
