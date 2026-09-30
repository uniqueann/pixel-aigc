import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from './http'
const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), sql: vi.fn(), verify: vi.fn(), eraseWithBailian: vi.fn(), getObject: vi.fn() }))
vi.mock('./auth', () => ({ authenticate: mocks.authenticate }))
vi.mock('./db', () => ({ runtimeScope: () => 'local', withIdentity: async (_id: string, _email: string, fn: (sql: unknown) => Promise<unknown>) => fn(Object.assign(mocks.sql, { json: (v: unknown) => v })) }))
vi.mock('./storage', () => ({
  verifyAndPromote: mocks.verify,
  signRead: vi.fn(),
  signUpload: vi.fn(),
  putObject: vi.fn(),
  getObject: mocks.getObject,
}))
vi.mock('./bailian-erase', () => ({ eraseWithBailian: mocks.eraseWithBailian }))
vi.mock('./sync-limits', () => ({ withSyncLimit: (_user: unknown, _bucket: string, action: () => Promise<unknown>) => action() }))
import handler from './handler'
import { HttpError } from './errors'
const draft = { prompt: '',presetKey: '1:1',count: 1,durationSeconds: 5 }
const body = { name: '测试',schemaVersion: 1,baseRevision: 3,document: { version: 1,activeSceneId: 's',scenes: [{ id: 's',name: '场景',width: 100,height: 100,viewport: { zoom: 1,panX: 0,panY: 0 },nodes: [] }] },drafts: { 'text-to-image': draft,'text-to-video': draft } }
async function request(payload: unknown, method='PUT', url='/api/projects/p') {
  const req = { headers: { authorization: 'Bearer test' },method,url,body: payload } as VercelRequest
  const response = { setHeader: vi.fn(),status: vi.fn(),json: vi.fn() }
  response.status.mockReturnValue(response)
  await handler(req,response as unknown as VercelResponse)
  return response
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.eraseWithBailian.mockReset()
  mocks.authenticate.mockResolvedValue({ id: 'owner',email: 'owner@example.com',suggestedName: '测试用户',avatarUrl: null,providers: ['email'] })
  mocks.sql.mockImplementation(async (parts: TemplateStringsArray) => {
    const query=parts.join('?')
    if (query.includes('initialize_member')) return [{ allowed: true }]
    if (query.includes('ensure_credit_account')) return [{ balance: 100 }]
    if (query.includes('from aigc.members m join')) return [{ displayName: '测试用户',workspaceId: '00000000-0000-4000-8000-000000000001',workspaceName: '我的工作空间',role: 'admin' }]
    if (query.includes('from aigc.credit_accounts')) return [{ balance: 100 }]
    if (query.includes('select status')) return [{ status: 'active' }]
    if (query.includes('select * from aigc.projects')) return [{ id: 'p',revision: 3 }]
    if (query.includes('update aigc.projects')) return [{ revision: 4 }]
    return []
  })
})
describe('API 认证、版本和写入边界', () => {
  it('已验证邮箱账号可初始化并获取个人空间，重复请求保持同一空间', async () => {
    const first = await request(undefined,'POST','/api/me')
    const second = await request(undefined,'POST','/api/me')
    expect(first.status).toHaveBeenCalledWith(200)
    expect(first.json).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner', credits: 100, workspace: expect.objectContaining({ id: '00000000-0000-4000-8000-000000000001' }) }))
    expect(second.json).toHaveBeenCalledWith(first.json.mock.calls[0][0])
  })
  it('停用成员初始化返回可识别的错误码', async () => {
    mocks.sql.mockResolvedValueOnce([{ allowed: false }])
    const res = await request(undefined,'POST','/api/me')
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'MEMBER_DISABLED' }))
  })
  it('无有效身份时不会访问数据库', async () => {
    mocks.authenticate.mockRejectedValue(new HttpError(401,'请登录'))
    const res = await request(body)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(mocks.sql).not.toHaveBeenCalled()
  })
  it('非成员不能保存项目', async () => {
    mocks.sql.mockResolvedValue([])
    expect((await request(body)).status).toHaveBeenCalledWith(403)
    expect(mocks.sql).toHaveBeenCalledTimes(1)
  })
  it('过期版本返回 409，不执行 UPDATE', async () => {
    expect((await request({ ...body,baseRevision: 2 })).status).toHaveBeenCalledWith(409)
    expect(mocks.sql.mock.calls.some(call => call[0].join('').includes('update aigc.projects'))).toBe(false)
  })
  it('持有行锁核验版本后保存并返回新版本', async () => {
    const res = await request(body)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ revision: 4 })
    expect(mocks.sql.mock.calls.some(call => call[0].join('').includes('for update'))).toBe(true)
  })
  it('拒绝在项目写入中夹带服务器任务状态', async () => {
    expect((await request({ ...body,generations: { fake: { status: 'succeeded' } } })).status).toHaveBeenCalledWith(400)
  })
  it('完成上传不能访问不存在或不属于用户的素材', async () => {
    expect((await request({ projectId: 'p' },'POST','/api/assets/other/complete')).status).toHaveBeenCalledWith(404)
    expect(mocks.verify).not.toHaveBeenCalled()
  })

  it('未处理异常的日志带上 message、cause，响应仍是通用提示', async () => {
    mocks.authenticate.mockRejectedValue(new TypeError('fetch failed', { cause: new Error('Connect Timeout Error') }))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await request(undefined, 'POST', '/api/me')
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: '服务暂时不可用，请稍后重试', code: 'SERVER_ERROR' }))
    const logged = JSON.parse(String(spy.mock.calls.at(-1)?.[0])) as Record<string, unknown>
    expect(logged).toMatchObject({
      category: 'TypeError',
      message: 'fetch failed',
      cause: 'Error: Connect Timeout Error',
      status: 500,
    })
    spy.mockRestore()
  })

  it('capabilities 在配置 DragonCode Key 后打开智能编辑', async () => {
    const previous = process.env.DRAGONCODE_API_KEY
    process.env.DRAGONCODE_API_KEY = 'sk-test'
    const res = await request(undefined, 'GET', '/api/capabilities')
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ imageEdit: true, variation: true }))
    const models = await request(undefined, 'GET', '/api/image-models?operation=image_edit')
    expect(models.json).toHaveBeenCalledWith(expect.objectContaining({
      items: expect.arrayContaining([expect.objectContaining({ id: 'dragoncode:gpt-image-2' })]),
    }))
    if (previous === undefined) delete process.env.DRAGONCODE_API_KEY
    else process.env.DRAGONCODE_API_KEY = previous
  })

  it('capabilities 在配置百炼 Key 后同时打开扩图和消除', async () => {
    const previous = process.env.DASHSCOPE_API_KEY
    process.env.DASHSCOPE_API_KEY = 'sk-test'
    const res = await request(undefined, 'GET', '/api/capabilities')
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ outpaint: true, erase: true, imageEdit: false }))
    if (previous === undefined) delete process.env.DASHSCOPE_API_KEY
    else process.env.DASHSCOPE_API_KEY = previous
  })

  it('capabilities 在配置腾讯云后打开智能选区', async () => {
    const keys = ['TENCENT_COS_SECRET_ID', 'TENCENT_COS_SECRET_KEY', 'TENCENT_COS_BUCKET', 'TENCENT_COS_REGION'] as const
    const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
    for (const key of keys) process.env[key] = 'set'
    const res = await request(undefined, 'GET', '/api/capabilities')
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ bgRemove: true, smartSelect: true }))
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
  })

  it('消除路由把底图、蒙版和背景描述交给百炼模块', async () => {
    const previous = process.env.DASHSCOPE_API_KEY
    process.env.DASHSCOPE_API_KEY = 'sk-test'
    mocks.eraseWithBailian.mockResolvedValue(Buffer.from('jpeg'))
    const req = {
      headers: { authorization: 'Bearer test' },
      method: 'POST',
      url: '/api/erase',
      body: {
        mimeType: 'image/jpeg',
        dataBase64: Buffer.from('img').toString('base64'),
        maskMimeType: 'image/png',
        maskBase64: Buffer.from('mask').toString('base64'),
        prompt: '浅色木桌',
      },
    } as VercelRequest
    const response = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn(), end: vi.fn() }
    response.status.mockReturnValue(response)
    await handler(req, response as unknown as VercelResponse)
    expect(mocks.eraseWithBailian).toHaveBeenCalledWith(
      Buffer.from('img'),
      Buffer.from('mask'),
      '浅色木桌',
      expect.objectContaining({ requestId: expect.any(String) }),
    )
    expect(response.status).toHaveBeenCalledWith(200)
    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg')
    if (previous === undefined) delete process.env.DASHSCOPE_API_KEY
    else process.env.DASHSCOPE_API_KEY = previous
  })

  it('消除未配置 Key 时 503，不读库', async () => {
    const previous = process.env.DASHSCOPE_API_KEY
    delete process.env.DASHSCOPE_API_KEY
    const res = await request({
      mimeType: 'image/jpeg',
      dataBase64: 'aaaa',
      maskBase64: 'bbbb',
    }, 'POST', '/api/erase')
    expect(res.status).toHaveBeenCalledWith(503)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ERASE_UNAVAILABLE' }))
    expect(mocks.sql).not.toHaveBeenCalled()
    if (previous !== undefined) process.env.DASHSCOPE_API_KEY = previous
  })

  it('GET /api/objects 按当前用户读私有对象，不走浏览器直连 R2', async () => {
    mocks.getObject.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' })
    const req = { headers: { authorization: 'Bearer test' }, method: 'GET', url: '/api/objects?key=generated/owner/job/0.png&download=1&filename=裂变_1.png' }
    const response = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn(), end: vi.fn() }
    response.status.mockReturnValue(response)
    await handler(req as never, response as never)
    expect(mocks.getObject).toHaveBeenCalledWith('generated/owner/job/0.png')
    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png')
    expect(response.setHeader).toHaveBeenCalledWith('Content-Disposition', expect.stringContaining('filename*=UTF-8'))
    expect(response.status).toHaveBeenCalledWith(200)
    expect(response.end).toHaveBeenCalledWith(Buffer.from([1, 2, 3]))
  })

  it('GET /api/credits/ledger 返回当前用户流水', async () => {
    mocks.sql.mockImplementation(async (parts: TemplateStringsArray) => {
      const query = parts.join('?')
      if (query.includes('select status')) return [{ status: 'active' }]
      if (query.includes('ensure_credit_account')) return [{ balance: 100 }]
      if (query.includes('newest_id')) return [{
        group_id: '00000000-0000-4000-8000-000000000301',
        is_job: false,
        newest_at: '2026-09-29T00:00:00.000Z',
        newest_id: '00000000-0000-4000-8000-000000000301',
      }]
      if (query.includes('from aigc.credit_ledger')) return [{
        id: '00000000-0000-4000-8000-000000000301',
        job_id: null,
        kind: 'grant',
        delta: 100,
        balance_after: 100,
        charged: null,
        meta: {},
        reason: '首次赠送',
        created_at: '2026-09-29T00:00:00.000Z',
        capability: null,
        params: null,
        requested_count: null,
        provider_params: null,
      }]
      if (query.includes('from aigc.credit_accounts')) return [{ balance: 100 }]
      return []
    })
    const res = await request(undefined, 'GET', '/api/credits/ledger')
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      balance: 100,
      nextCursor: null,
      items: [expect.objectContaining({
        label: '赠送/充值',
        delta: 100,
        deltaText: '+100',
        reason: '首次赠送',
      })],
    })
  })

  it('429 限流响应带上 Retry-After 和剩余秒数', async () => {
    mocks.sql.mockImplementation(async () => {
      throw new HttpError(429, '该类图片操作已达到每小时使用上限，约 8 分钟后可再试', 'RATE_LIMIT', {
        extra: { retryAfterSeconds: 480 },
      })
    })
    const res = await request(undefined, 'GET', '/api/me')
    expect(res.status).toHaveBeenCalledWith(429)
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '480')
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: '该类图片操作已达到每小时使用上限，约 8 分钟后可再试',
      code: 'RATE_LIMIT',
      retryAfterSeconds: 480,
    }))
  })
})
