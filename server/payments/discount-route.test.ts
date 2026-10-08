import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpError } from '../errors'
import type { VercelRequest, VercelResponse } from '../http'
const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), sql: vi.fn(), preview: vi.fn() }))
vi.mock('../auth', () => ({ authenticate: mocks.authenticate }))
vi.mock('../db', () => ({
  withIdentity: async (_id: string, _email: string, action: (sql: unknown) => Promise<unknown>) => action(mocks.sql),
  runtimeScope: () => 'preview',
}))
vi.mock('./service', () => ({ previewCreditDiscount: mocks.preview }))
import handler from '../handler'
async function request(body: unknown) {
  const response = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn() }
  response.status.mockReturnValue(response)
  await handler({ headers: { authorization: 'Bearer test' }, method: 'POST', url: '/api/credits/discount-preview', body } as VercelRequest,
    response as unknown as VercelResponse)
  return response
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.authenticate.mockResolvedValue({ id: 'owner', email: 'buyer@example.com' })
  mocks.sql.mockResolvedValue([{ status: 'active' }]); mocks.preview.mockResolvedValue({ code: 'AIGC10', packs: [] })
})
describe('折扣预览路由认证', () => {
  it('只将已认证成员身份与请求传给服务端预览', async () => {
    const body = { provider: 'creem', code: 'AIGC10', expectedCurrency: 'USD' }
    expect((await request(body)).status).toHaveBeenCalledWith(200)
    expect(mocks.preview).toHaveBeenCalledWith({ id: 'owner', email: 'buyer@example.com' }, body)
  })
  it('未登录不能调用折扣平台', async () => {
    mocks.authenticate.mockRejectedValueOnce(new HttpError(401, '请登录'))
    expect((await request({})).status).toHaveBeenCalledWith(401)
    expect(mocks.preview).not.toHaveBeenCalled()
  })
})
