import { describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ findCreate: vi.fn().mockResolvedValue(null), findBatch: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: '创建结果' }), quote: vi.fn() }))
vi.mock('./projects.js', () => ({ createSuite: mock.create, findSuiteByRequest: mock.findCreate, getSuite: vi.fn(), listSuites: vi.fn(), listSuiteVersions: vi.fn(), recycleSuite: vi.fn(), saveSuiteDraft: vi.fn(), selectSuiteVersion: vi.fn(), updateSuite: vi.fn() }))
vi.mock('./generation.js', () => ({ createSuiteBatch: vi.fn(), findSuiteBatch: mock.findBatch, quoteSuite: mock.quote }))
import { handleEcommerceSuiteRoute } from './route.js'
const user = { id: crypto.randomUUID(), email: 'fixture@example.invalid', suggestedName: '测试', avatarUrl: null, providers: [] }
vi.stubEnv('ECOMMERCE_SUITE_ENABLED', 'true')
describe('套图 HTTP 路径契约', () => {
  it('创建成功使用 201，原创建查找只调用读服务', async () => {
    expect(await handleEcommerceSuiteRoute(user, 'POST', ['ecommerce', 'suites'], {}, new URLSearchParams())).toMatchObject({ status: 201 })
    const id = crypto.randomUUID()
    expect(await handleEcommerceSuiteRoute(user, 'GET', ['ecommerce', 'suites', 'by-request', id], undefined, new URLSearchParams())).toEqual({ body: null })
    expect(mock.findCreate).toHaveBeenCalledWith(user, id)
  })
  it('提交响应丢失的查找不能转入报价或再次提交', async () => {
    const id = crypto.randomUUID(), request = crypto.randomUUID()
    expect(await handleEcommerceSuiteRoute(user, 'GET', ['ecommerce', 'suites', id, 'batches', 'by-request', request], undefined, new URLSearchParams())).toEqual({ body: null })
    expect(mock.findBatch).toHaveBeenCalledWith(user, id, request)
    expect(mock.quote).not.toHaveBeenCalled()
  })
  it('拒绝非法身份与未实现的多槽位维护路径', async () => {
    await expect(handleEcommerceSuiteRoute(user, 'GET', ['ecommerce', 'suites', '不合法'], undefined, new URLSearchParams())).rejects.toThrow()
    await expect(handleEcommerceSuiteRoute(user, 'POST', ['ecommerce', 'maintenance'], {}, new URLSearchParams())).rejects.toMatchObject({ status: 404 })
  })
})
