import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authorizeSuiteCleanup, authorizeSuiteMaintenance } from './maintenance-route'
import { ecommerceSuiteDispatchReady } from './config'

beforeEach(() => {
  vi.stubEnv('IMAGE_CRON_SECRET', '套图维护密钥')
  vi.stubEnv('AIGC_RUNTIME_SCOPE', 'preview')
  vi.stubEnv('ECOMMERCE_SUITE_ENABLED', 'true')
  vi.stubEnv('ECOMMERCE_SUITE_MAINTENANCE_ENABLED', 'true')
  vi.stubEnv('IMAGE_MAINTENANCE_ENABLED', 'true')
  vi.stubEnv('IMAGE_BACKGROUND_SUBMIT_ENABLED', 'true')
})
afterEach(() => vi.unstubAllEnvs())
describe('套图内部维护范围与首发保护', () => {
  it('清理使用独立开关与密钥校验，入口关闭不影响显式启用的清理', () => {
    expect(() => authorizeSuiteCleanup('Bearer 套图维护密钥', { scope: 'preview' })).toThrow('尚未启用')
    vi.stubEnv('ECOMMERCE_SUITE_CLEANUP_ENABLED', 'true')
    vi.stubEnv('ECOMMERCE_SUITE_ENABLED', 'false')
    expect(() => authorizeSuiteCleanup('Bearer 套图维护密钥', { scope: 'preview' })).not.toThrow()
    expect(() => authorizeSuiteCleanup('Bearer 用户令牌', { scope: 'preview' })).toThrow('未授权')
    expect(() => authorizeSuiteCleanup('Bearer 套图维护密钥', { scope: 'production' })).toThrow('环境不匹配')
  })
  it('正确独立密钥与同环境可以通过，不接受普通账号令牌', () => {
    expect(() => authorizeSuiteMaintenance('Bearer 套图维护密钥', { scope: 'preview' })).not.toThrow()
    expect(() => authorizeSuiteMaintenance('Bearer 用户令牌', { scope: 'preview' })).toThrow('未授权')
  })
  it.each([{ scope: 'production' }, {}, { scope: 'preview', userId: crypto.randomUUID() }])('拒绝跨环境或额外身份 %j', body => {
    expect(() => authorizeSuiteMaintenance('Bearer 套图维护密钥', body)).toThrow()
  })
  it.each(['ECOMMERCE_SUITE_ENABLED', 'ECOMMERCE_SUITE_MAINTENANCE_ENABLED', 'IMAGE_MAINTENANCE_ENABLED', 'IMAGE_BACKGROUND_SUBMIT_ENABLED'])('缺少 %s 不接受新计划', flag => {
    expect(ecommerceSuiteDispatchReady()).toBe(true)
    vi.stubEnv(flag, 'false')
    expect(ecommerceSuiteDispatchReady()).toBe(false)
  })
})
