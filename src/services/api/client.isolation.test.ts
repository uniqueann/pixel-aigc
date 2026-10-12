// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { useUserStore, type AccountContext } from '@/store/useUserStore'
const mocks = vi.hoisted(() => ({ session: vi.fn() }))
vi.mock('@/cloud/client', () => ({
  authEnabled: true,
  supabase: { auth: { getSession: mocks.session } },
}))
import { apiClient } from './client'
const owner = '00000000-0000-4000-8000-000000000081',
  other = '00000000-0000-4000-8000-000000000082'
function login(
  userId = owner,
  scope: AccountContext['runtimeScope'] = 'preview',
) {
  useUserStore
    .getState()
    .setAccount({ userId, runtimeScope: scope } as AccountContext)
}
beforeEach(() => {
  vi.clearAllMocks()
  login()
  mocks.session.mockResolvedValue({
    data: { session: { user: { id: owner }, access_token: '测试令牌' } },
  })
})
afterEach(() => useUserStore.getState().setAccount(null))
describe('原 API 账号和环境隔离', () => {
  it('等待凭据期间切换账号，生成 POST 不会发送到新账号', async () => {
    let done!: (session: unknown) => void
    mocks.session.mockImplementation(
      () =>
        new Promise((resolve) => {
          done = resolve
        }),
    )
    const adapter = vi.fn()
    const request = apiClient.post(
      '/tasks',
      { requestId: 'original' },
      { adapter },
    )
    const rejected = expect(request).rejects.toMatchObject({
      code: 'ACCOUNT_CHANGED',
      status: 401,
    })
    await vi.waitFor(() => expect(mocks.session).toHaveBeenCalled())
    login(other)
    done({ data: { session: { user: { id: other }, access_token: '新令牌' } } })
    await rejected
    expect(adapter).not.toHaveBeenCalled()
  })
  it('旧账号响应和同账号不同环境响应都不会被消费', async () => {
    for (const next of [
      { userId: other, scope: 'preview' as const },
      { userId: owner, scope: 'production' as const },
    ]) {
      login()
      let done!: (value: unknown) => void
      const adapter = vi.fn(
        (config: InternalAxiosRequestConfig) =>
          new Promise<AxiosResponse>((resolve) => {
            done = () =>
              resolve({
                config,
                data: { id: '旧任务' },
                status: 200,
                statusText: 'OK',
                headers: {},
              })
          }),
      )
      const request = apiClient.get('/tasks/old', { adapter })
      const rejected = expect(request).rejects.toMatchObject({
        code: 'ACCOUNT_CHANGED',
      })
      await vi.waitFor(() => expect(adapter).toHaveBeenCalled())
      login(next.userId, next.scope)
      done(undefined)
      await rejected
    }
  })
})
