import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import type { VercelRequest,VercelResponse } from '../http.js'
const mocks = vi.hoisted(() => ({ maintain: vi.fn(),waitUntil: vi.fn(),authenticate: vi.fn() }))
vi.mock('./maintenance.js',() => ({ maintainImageJobs: mocks.maintain }))
vi.mock('../auth.js',() => ({ authenticate: mocks.authenticate }))
vi.mock('@vercel/functions',() => ({ waitUntil: mocks.waitUntil,getDeadline: () => undefined }))
import handler from '../handler.js'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('IMAGE_CRON_SECRET','图片维护独立密钥')
  vi.stubEnv('IMAGE_MAINTENANCE_ENABLED','true')
  vi.stubEnv('AIGC_RUNTIME_SCOPE','preview')
  mocks.maintain.mockResolvedValue({ claimed: 0,failed: 0 })
})
afterEach(() => vi.unstubAllEnvs())

async function request(body: unknown = { scope: 'preview' },secret = '图片维护独立密钥') {
  const response = { status: vi.fn(),json: vi.fn(),setHeader: vi.fn(),end: vi.fn() }
  response.status.mockReturnValue(response)
  await handler({ method: 'POST',url: '/api/internal/image-jobs-maintenance',headers: { authorization: `Bearer ${secret}` },body } as VercelRequest,
    response as unknown as VercelResponse)
  return response
}

describe('图片分钟维护内部路由',() => {
  it('校验独立密钥和环境，202 返回 runId 后启动后台执行',async () => {
    const response = await request()
    expect(response.status).toHaveBeenCalledWith(202)
    expect(response.json).toHaveBeenCalledWith({ received: true,scope: 'preview',runId: expect.any(String) })
    expect(mocks.maintain).toHaveBeenCalledWith(undefined,expect.any(String))
    expect(mocks.waitUntil).toHaveBeenCalledTimes(1)
    await mocks.waitUntil.mock.calls[0][0]
    expect(mocks.authenticate).not.toHaveBeenCalled()
  })
  it('错误密钥不会运行维护器，中文密钥按字节长度检查',async () => {
    const response = await request({ scope: 'preview' },'错误密钥')
    expect(response.status).toHaveBeenCalledWith(401)
    expect(mocks.maintain).not.toHaveBeenCalled()
  })
  it.each([{ scope: 'production' },{}, { scope: 'preview',other: true }])('请求范围不能选择其他环境或扩展参数 %j',async body => {
    const response = await request(body)
    expect(response.status).toHaveBeenCalledWith(400)
    expect(mocks.maintain).not.toHaveBeenCalled()
  })
  it('默认关闭时返回 503，不领取任务',async () => {
    vi.stubEnv('IMAGE_MAINTENANCE_ENABLED','false')
    const response = await request()
    expect(response.status).toHaveBeenCalledWith(503)
    expect(mocks.waitUntil).not.toHaveBeenCalled()
  })
})
