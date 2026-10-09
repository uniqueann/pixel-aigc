import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CREDIT_PACKS } from '../../shared/billing'
import { HttpError } from '../errors'

const mocks = vi.hoisted(() => ({ read: vi.fn(), validate: vi.fn(), providers: vi.fn(), limit: vi.fn() }))
vi.mock('../sync-limits', () => ({ withSyncLimit: mocks.limit }))
vi.mock('./providers', async importOriginal => ({
  ...await importOriginal<typeof import('./providers')>(),
  configuredProviders: mocks.providers, creditCurrency: () => 'USD',
  productId: (_provider: string, pack: string) => `prod_${pack}`,
  readProviderDiscount: mocks.read, validateProduct: mocks.validate,
}))
import { previewCreditDiscount } from './service'
const user = { id: 'owner', email: 'buyer@example.com' }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.limit.mockImplementation((_user, _bucket, action) => action())
  mocks.providers.mockReturnValue(['dodo', 'creem']); mocks.validate.mockResolvedValue(undefined)
  mocks.read.mockResolvedValue({ id: 'dis_aigc', code: 'AIGC10', percentBps: 1000, productIds: ['prod_standard', 'prod_studio'], used: 0, active: true })
})
describe('各档套餐的折扣预览', () => {
  it('一次查询平台券，分别验证套餐，返回部分适用的美元报价', async () => {
    const result = await previewCreditDiscount(user, { provider: 'creem', code: ' aigc10 ', expectedCurrency: 'USD' })
    expect(result).toMatchObject({ provider: 'creem', currency: 'USD', code: 'AIGC10' })
    expect(result.packs[0]).toMatchObject({ amount: 299, available: false, discount: null, message: '此折扣代码不适用于当前套餐' })
    expect(result.packs.slice(1).map(pack => pack.discount?.payableAmount)).toEqual([629, 1799])
    expect(mocks.read).toHaveBeenCalledTimes(1)
    expect(mocks.limit).toHaveBeenCalledWith(user, 'payment_discount', expect.any(Function))
    for (const pack of CREDIT_PACKS) expect(mocks.validate).toHaveBeenCalledWith('creem', `prod_${pack.id}`, pack.USD, 'USD')
  })
  it('未知码按套餐展示原因；权限不足、平台不可用不伪装成无效码', async () => {
    mocks.read.mockRejectedValueOnce(new HttpError(400, '折扣代码不存在', 'DISCOUNT_INVALID'))
    const result = await previewCreditDiscount(user, { provider: 'dodo', code: 'NOPE', expectedCurrency: 'USD' })
    expect(result.packs.every(pack => !pack.available && pack.message === '折扣代码不存在')).toBe(true)
    expect(mocks.validate).not.toHaveBeenCalled()
    for (const code of ['DISCOUNT_UNCONFIGURED', 'DISCOUNT_UNAVAILABLE']) {
      mocks.read.mockRejectedValueOnce(new HttpError(503, '折扣验证暂不可用', code))
      await expect(previewCreditDiscount(user, { provider: 'dodo', code: 'AIGC10', expectedCurrency: 'USD' })).rejects.toMatchObject({ status: 503, code })
    }
  })
  it('格式、币种、关闭通道或限流拒绝后不调用支付平台', async () => {
    for (const code of ['', 'AIGC-10', 'A'.repeat(15)])
      await expect(previewCreditDiscount(user, { provider: 'dodo', code, expectedCurrency: 'USD' })).rejects.toMatchObject({ status: 400 })
    await expect(previewCreditDiscount(user, { provider: 'dodo', code: 'AIGC10', expectedCurrency: 'CNY' })).rejects.toMatchObject({ code: 'PRICE_CHANGED' })
    mocks.providers.mockReturnValue([])
    await expect(previewCreditDiscount(user, { provider: 'creem', code: 'AIGC10', expectedCurrency: 'USD' })).rejects.toMatchObject({ code: 'PAYMENT_UNCONFIGURED' })
    mocks.providers.mockReturnValue(['dodo'])
    mocks.limit.mockRejectedValueOnce(new HttpError(429, '折扣验证已达到每小时上限', 'RATE_LIMIT'))
    await expect(previewCreditDiscount(user, { provider: 'dodo', code: 'AIGC10', expectedCurrency: 'USD' })).rejects.toMatchObject({ status: 429 })
    mocks.limit.mockRejectedValueOnce(new HttpError(403, '当前账号未开通此应用', 'MEMBER_DISABLED'))
    await expect(previewCreditDiscount(user, { provider: 'dodo', code: 'AIGC10', expectedCurrency: 'USD' })).rejects.toMatchObject({ status: 403 })
    expect(mocks.read).not.toHaveBeenCalled()
  })
})
