import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from './http'
const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(), sql: vi.fn(), verify: vi.fn(), eraseWithBailian: vi.fn(),
  repaintWithBailian: vi.fn(), expandWithBailian: vi.fn(),
  removeBackground: vi.fn(),
  detectSubject: vi.fn(), selectMask: vi.fn(),
  getObject: vi.fn(), loadEraseStoredImage: vi.fn(), loadStoredSyncImage: vi.fn(), validateSyncImage: vi.fn(), metrics: [] as unknown[], putObject: vi.fn(), signRead: vi.fn(),
}))
vi.mock('./auth', () => ({ authenticate: mocks.authenticate }))
vi.mock('./db', () => ({ runtimeScope: () => 'local', withIdentity: async (_id: string, _email: string, fn: (sql: unknown) => Promise<unknown>) => fn(Object.assign(mocks.sql, { json: (v: unknown) => v })) }))
vi.mock('./storage', () => ({
  verifyAndPromote: mocks.verify,
  signRead: mocks.signRead,
  signUpload: vi.fn(),
  putObject: mocks.putObject,
  getObject: mocks.getObject,
}))
vi.mock('./bailian-erase', () => ({ eraseWithBailian: mocks.eraseWithBailian }))
vi.mock('./bailian-repaint', () => ({ repaintWithBailian: mocks.repaintWithBailian }))
vi.mock('./bg-remove', () => ({ removeBackground: mocks.removeBackground }))
vi.mock('./tencent-ci', async importOriginal => ({ ...await importOriginal<typeof import('./tencent-ci')>(), detectGoodsSubject: mocks.detectSubject }))
vi.mock('./segment/select', async importOriginal => ({ ...await importOriginal<typeof import('./segment/select')>(), selectSmartMask: mocks.selectMask }))
vi.mock('./bailian-outpaint', async importOriginal => ({
  ...(await importOriginal<typeof import('./bailian-outpaint')>()), expandWithBailian: mocks.expandWithBailian,
}))
vi.mock('./erase-storage', () => ({
  loadEraseStoredImage: mocks.loadEraseStoredImage, loadStoredSyncImage: mocks.loadStoredSyncImage, validateSyncImage: mocks.validateSyncImage,
}))
vi.mock('./sync-limits', () => ({ withSyncLimit: (_user: unknown, _bucket: string, action: () => Promise<unknown>, metrics?: unknown) => { mocks.metrics.push(metrics); return action() } }))
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
  mocks.metrics.length = 0
  mocks.eraseWithBailian.mockReset()
  mocks.repaintWithBailian.mockReset()
  mocks.expandWithBailian.mockReset()
  mocks.removeBackground.mockReset()
  mocks.loadEraseStoredImage.mockReset()
  mocks.loadStoredSyncImage.mockReset()
  mocks.putObject.mockReset()
  mocks.signRead.mockReset()
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

describe('智能抠图同步传输接口', () => {
  beforeEach(() => {
    for (const key of ['TENCENT_COS_SECRET_ID', 'TENCENT_COS_SECRET_KEY', 'TENCENT_COS_BUCKET', 'TENCENT_COS_REGION']) vi.stubEnv(key, 'configured')
    mocks.removeBackground.mockResolvedValue(Buffer.from('png'))
  })
  afterEach(() => vi.unstubAllEnvs())
  async function mattingRequest(payload: unknown) {
    const response = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn(), end: vi.fn() }
    response.status.mockReturnValue(response)
    await handler({ headers: { authorization: 'Bearer test' }, method: 'POST', url: '/api/bg-remove', body: payload } as VercelRequest, response as unknown as VercelResponse)
    return response
  }
  it('旧内联请求仍返回 PNG，并使用检测限流与阶段记录', async () => {
    const res = await mattingRequest({ mimeType: 'image/png', dataBase64: 'aW1n', clientTimingMs: { prepare: 2, upload: 0 } })
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png')
    expect(res.end).toHaveBeenCalledWith(Buffer.from('png'))
    expect(mocks.validateSyncImage).toHaveBeenCalledWith(Buffer.from('img'), 'source', 'image/png', 24_000_000)
    expect(mocks.metrics.at(-1)).toMatchObject({ route: 'bg-remove', transport: 'inline', inputBytes: 3, outputBytes: 3, stageMs: { clientPrepare: 2 } })
  })
  it('对象输入校验后进入地址读图，大 PNG 返回对象描述', async () => {
    const png = Buffer.alloc(4 * 1024 * 1024)
    mocks.loadStoredSyncImage.mockResolvedValue({ bytes: Buffer.from('source'), width: 3200, height: 5035 })
    mocks.removeBackground.mockResolvedValue(png)
    mocks.signRead.mockResolvedValue({ url: 'https://r2.test/png', expiresAt: 123 })
    const res = await mattingRequest({ sourceImageKey: 'temporary/task-inputs/owner/image', clientTimingMs: { prepare: 2, upload: 5 } })
    expect(mocks.loadStoredSyncImage).toHaveBeenCalledWith('owner', 'temporary/task-inputs/owner/image', 'source', expect.any(AbortSignal), expect.objectContaining({ maxPixels: 24_000_000 }))
    expect(mocks.removeBackground).toHaveBeenCalledWith(Buffer.from('source'), expect.objectContaining({ sourceImageKey: 'temporary/task-inputs/owner/image', deadlineAt: expect.any(Number) }))
    expect(mocks.putObject).toHaveBeenCalledWith(expect.stringMatching(/^temporary\/bg-remove-results\/owner\/.+\.png$/), png, 'image/png', expect.any(AbortSignal))
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://r2.test/png', mimeType: 'image/png', bytes: png.length }))
    expect(res.end).not.toHaveBeenCalled()
  })
  it('拒绝混合输入和外部源图地址，不调用腾讯', async () => {
    expect((await mattingRequest({ sourceImageKey: 'temporary/task-inputs/owner/image', mimeType: 'image/png', dataBase64: 'aW1n' })).status).toHaveBeenCalledWith(400)
    expect((await mattingRequest({ sourceImageUrl: 'https://external.test/a.jpg' })).status).toHaveBeenCalledWith(400)
    expect(mocks.removeBackground).not.toHaveBeenCalled()
  })
  it('校验失败仍保留读取大小和耗时，不调用腾讯', async () => {
    mocks.loadStoredSyncImage.mockImplementation(async (_owner, _key, _kind, _signal, options) => {
      options.onRead(1024, 3)
      options.onValidate({ stage: 'imageValidate', ms: 2, valid: false })
      throw new HttpError(400, '图片文件损坏', 'INVALID_IMAGE')
    })
    const res = await mattingRequest({ sourceImageKey: 'temporary/task-inputs/owner/broken' })
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mocks.removeBackground).not.toHaveBeenCalled()
    expect(mocks.metrics.at(-1)).toMatchObject({ inputBytes: 1024, stageMs: { objectRead: 3, imageValidate: 2 } })
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

  it('消除对象键请求读取用户图片并沿用小结果直返', async () => {
    const previous = process.env.DASHSCOPE_API_KEY
    process.env.DASHSCOPE_API_KEY = 'sk-test'
    mocks.loadEraseStoredImage
      .mockResolvedValueOnce({ bytes: Buffer.from('source'), width: 10, height: 10 })
      .mockResolvedValueOnce({ bytes: Buffer.from('mask'), width: 10, height: 10 })
    mocks.eraseWithBailian.mockResolvedValue(Buffer.from('result'))
    const req = { headers: { authorization: 'Bearer test' }, method: 'POST', url: '/api/erase', body: {
      sourceImageKey: 'generated/owner/job/0.png', maskImageKey: 'temporary/task-inputs/owner/mask', prompt: '移除物体',
    } } as VercelRequest
    const res = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn(), end: vi.fn() }
    res.status.mockReturnValue(res)
    await handler(req, res as unknown as VercelResponse)
    expect(mocks.loadEraseStoredImage).toHaveBeenCalledTimes(2)
    expect(mocks.eraseWithBailian).toHaveBeenCalledWith(Buffer.from('source'), Buffer.from('mask'), '移除物体', expect.any(Object))
    expect(res.end).toHaveBeenCalledWith(Buffer.from('result'))
    expect(mocks.putObject).not.toHaveBeenCalled()
    if (previous === undefined) delete process.env.DASHSCOPE_API_KEY
    else process.env.DASHSCOPE_API_KEY = previous
  })

  it('大结果写入临时对象，返回签名地址', async () => {
    const previous = process.env.DASHSCOPE_API_KEY
    process.env.DASHSCOPE_API_KEY = 'sk-test'
    const jpeg = Buffer.alloc(4 * 1024 * 1024, 1)
    mocks.eraseWithBailian.mockResolvedValue(jpeg)
    mocks.signRead.mockResolvedValue({ url: 'https://r2.test/result', expiresAt: 123 })
    const req = { headers: { authorization: 'Bearer test' }, method: 'POST', url: '/api/erase', body: {
      mimeType: 'image/jpeg', dataBase64: 'aW1n', maskBase64: 'bWFzaw==',
    } } as VercelRequest
    const res = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn(), end: vi.fn() }
    res.status.mockReturnValue(res)
    await handler(req, res as unknown as VercelResponse)
    expect(mocks.putObject).toHaveBeenCalledWith(expect.stringMatching(/^temporary\/erase-results\/owner\//), jpeg, 'image/jpeg')
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'image/jpeg', bytes: jpeg.length, url: 'https://r2.test/result' }))
    expect(res.end).not.toHaveBeenCalled()
    if (previous === undefined) delete process.env.DASHSCOPE_API_KEY
    else process.env.DASHSCOPE_API_KEY = previous
  })

  it('重绘对象请求读取原图与蒙版，大结果经私有对象返回', async () => {
    const previous = process.env.DASHSCOPE_API_KEY
    process.env.DASHSCOPE_API_KEY = 'sk-test'
    const jpeg = Buffer.alloc(4 * 1024 * 1024, 1)
    mocks.loadStoredSyncImage
      .mockResolvedValueOnce({ bytes: Buffer.from('source'), width: 10, height: 10 })
      .mockResolvedValueOnce({ bytes: Buffer.from('mask'), width: 10, height: 10 })
    mocks.repaintWithBailian.mockResolvedValue(jpeg)
    mocks.signRead.mockResolvedValue({ url: 'https://r2.test/repaint', expiresAt: 123 })
    const req = { headers: { authorization: 'Bearer test' }, method: 'POST', url: '/api/repaint', body: {
      sourceImageKey: 'generated/owner/job/0.png', maskImageKey: 'temporary/task-inputs/owner/mask',
      prompt: '玻璃花瓶', clientTimingMs: { prepare: 2, upload: 3 },
    } } as VercelRequest
    const res = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn(), end: vi.fn() }
    res.status.mockReturnValue(res)
    await handler(req, res as unknown as VercelResponse)
    expect(mocks.loadStoredSyncImage).toHaveBeenNthCalledWith(1, 'owner', 'generated/owner/job/0.png', 'source', expect.any(AbortSignal))
    expect(mocks.loadStoredSyncImage).toHaveBeenNthCalledWith(2, 'owner', 'temporary/task-inputs/owner/mask', 'mask', expect.any(AbortSignal))
    expect(mocks.repaintWithBailian).toHaveBeenCalledWith(Buffer.from('source'), Buffer.from('mask'), '玻璃花瓶', expect.objectContaining({
      deadlineAt: expect.any(Number),
    }))
    expect(mocks.putObject.mock.calls[0][0]).toMatch(/^temporary\/repaint-results\/owner\//)
    expect(mocks.putObject.mock.calls[0][1]).toBe(jpeg)
    expect(mocks.putObject.mock.calls[0][2]).toBe('image/jpeg')
    expect(mocks.putObject.mock.calls[0][3]).toBeInstanceOf(AbortSignal)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://r2.test/repaint', bytes: jpeg.length }))
    if (previous === undefined) delete process.env.DASHSCOPE_API_KEY
    else process.env.DASHSCOPE_API_KEY = previous
  })

  it('扩图对象请求读取原图，小结果直接返回图片', async () => {
    const previous = process.env.DASHSCOPE_API_KEY
    process.env.DASHSCOPE_API_KEY = 'sk-test'
    mocks.loadStoredSyncImage.mockResolvedValue({ bytes: Buffer.from('source'), width: 10, height: 10 })
    mocks.expandWithBailian.mockResolvedValue(Buffer.from('result'))
    const padding = { left: 5, right: 0, top: 0, bottom: 0 }
    const req = { headers: { authorization: 'Bearer test' }, method: 'POST', url: '/api/outpaint', body: {
      sourceImageKey: 'temporary/task-inputs/owner/source', padding,
    } } as VercelRequest
    const res = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn(), end: vi.fn() }
    res.status.mockReturnValue(res)
    await handler(req, res as unknown as VercelResponse)
    expect(mocks.loadStoredSyncImage).toHaveBeenCalledWith('owner', 'temporary/task-inputs/owner/source', 'source', expect.any(AbortSignal), expect.objectContaining({ maxPixels: 64_000_000, onRead: expect.any(Function), onValidate: expect.any(Function) }))
    expect(mocks.expandWithBailian).toHaveBeenCalledWith(Buffer.from('source'), padding, expect.objectContaining({
      deadlineAt: expect.any(Number),
    }))
    expect(res.end).toHaveBeenCalledWith(Buffer.from('result'))
    if (previous === undefined) delete process.env.DASHSCOPE_API_KEY
    else process.env.DASHSCOPE_API_KEY = previous
  })

  it('扩图对象格式校验失败仍保留读取字节数及校验耗时，不提交百炼', async () => {
    vi.stubEnv('DASHSCOPE_API_KEY', 'sk-test')
    mocks.loadStoredSyncImage.mockImplementation(async (_owner, _key, _kind, _signal, options) => {
      options.onRead(1024, 7)
      options.onValidate({ stage: 'imageValidate', ms: 3, valid: false })
      throw new HttpError(400, '图片文件损坏或无法解码', 'INVALID_IMAGE')
    })
    const res = await request({ sourceImageKey: 'temporary/task-inputs/owner/broken', padding: { left: 5, right: 0, top: 0, bottom: 0 } }, 'POST', '/api/outpaint')
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mocks.expandWithBailian).not.toHaveBeenCalled()
    expect(mocks.metrics.at(-1)).toMatchObject({ inputBytes: 1024, stageMs: { objectRead: 7, imageValidate: 3 } })
    vi.unstubAllEnvs()
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

describe('检测观测接口兼容', () => {
  it('主体检测旧请求保持兼容，新请求保存客户端与外部调用阶段', async () => {
    mocks.detectSubject.mockImplementation(async (_image, _width, _height, _config, _cos, log) => {
      log({ stage: 'cosUpload', ms: 9 }); log({ stage: 'subjectDetect', ms: 15 })
      return { x: 0.2, y: 0.1, width: 0.5, height: 0.5 }
    })
    const body = { mimeType: 'image/jpeg', dataBase64: 'aW1n', width: 100, height: 80 }
    const old = await request(body, 'POST', '/api/subject-detect')
    expect(old.status).toHaveBeenCalledWith(200)
    expect(old.json).toHaveBeenCalledWith(expect.objectContaining({ box: expect.any(Object), requestId: expect.any(String) }))
    await request({ ...body, clientTimingMs: { decode: 2, encode: 4, base64: 1 } }, 'POST', '/api/subject-detect')
    expect(mocks.metrics.at(-1)).toMatchObject({ route: 'subject-detect', inputBytes: 3, outputBytes: expect.any(Number),
      stageMs: { clientDecode: 2, clientEncode: 4, clientBase64: 1, cosUpload: 9, subjectDetect: 15 } })
  })
  it('选区会话 miss 返回 200 且不回传会话，记录 outcome 与实际字节', async () => {
    const debug = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    mocks.selectMask.mockImplementation(async (_input, _provider, log) => {
      log({ stage: 'cacheLookup', ms: 2 }); log({ cacheSource: 'session-cache' }); log({ outcome: 'miss' })
      return { miss: true, code: 'SMART_SELECT_MISS', message: '没有点中商品，请点在商品上。水印和文字请用画笔' }
    })
    const session = { provider: 'tencent-goods', payload: '测试会话' }
    const response = await request({ session, point: { x: 0.1, y: 0.2 } }, 'POST', '/api/smart-select')
    expect(response.status).toHaveBeenCalledWith(200)
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      miss: true, code: 'SMART_SELECT_MISS', requestId: expect.any(String),
    }))
    const body = response.json.mock.calls[0][0] as { session?: unknown }
    expect(body.session).toBeUndefined()
    expect(mocks.metrics.at(-1)).toMatchObject({
      route: 'smart-select',
      inputBytes: Buffer.byteLength(session.payload),
      outputBytes: Buffer.byteLength(JSON.stringify(response.json.mock.calls[0][0])),
      errorCode: 'SMART_SELECT_MISS',
      stageMs: { cacheLookup: 2 },
    })
    const logs = debug.mock.calls.map(([value]) => JSON.parse(value))
    expect(logs).toContainEqual(expect.objectContaining({ route: 'smart-select', cacheSource: 'session-cache', requestId: expect.any(String) }))
    expect(logs).toContainEqual(expect.objectContaining({ route: 'smart-select', outcome: 'miss', requestId: expect.any(String) }))
    expect(logs).toContainEqual(expect.objectContaining({ evt: 'smart-select', outcome: 'miss', status: 200 }))
    expect(JSON.stringify(logs)).not.toMatch(/测试会话|Bearer|dataBase64/)
    debug.mockRestore()
  })
  it('会话恢复后的 miss 仍回传新会话', async () => {
    const restored = { provider: 'tencent-goods', payload: '恢复后的会话' }
    mocks.selectMask.mockResolvedValue({
      miss: true, code: 'SMART_SELECT_MISS', message: '没有点中商品，请点在商品上。水印和文字请用画笔', session: restored,
    })
    const response = await request({ session: { provider: 'tencent-goods', payload: '{' }, point: { x: 0.1, y: 0.2 }, dataBase64: 'aW1n' }, 'POST', '/api/smart-select')
    expect(response.status).toHaveBeenCalledWith(200)
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ miss: true, session: restored, requestId: expect.any(String) }))
    expect(mocks.metrics.at(-1)).toMatchObject({ errorCode: 'SMART_SELECT_MISS', outputBytes: Buffer.byteLength(JSON.stringify(response.json.mock.calls[0][0])) })
  })
  it('真正的选区失败仍返回原状态码', async () => {
    mocks.selectMask.mockRejectedValue(new HttpError(503, '智能选区尚未配置', 'SMART_SELECT_UNCONFIGURED'))
    const response = await request({ session: { provider: 'tencent-goods', payload: 'x' }, point: { x: 0.1, y: 0.2 } }, 'POST', '/api/smart-select')
    expect(response.status).toHaveBeenCalledWith(503)
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'SMART_SELECT_UNCONFIGURED' }))
  })
  it.each([{ decode: -1 }, { encode: Infinity }, { read: 300001 }, { other: 2 }])('拒绝无效客户端阶段 %j', async clientTimingMs => {
    mocks.detectSubject.mockClear()
    const response = await request({ mimeType: 'image/jpeg', dataBase64: 'aW1n', width: 100, height: 80, clientTimingMs }, 'POST', '/api/subject-detect')
    expect(response.status).toHaveBeenCalledWith(400)
    expect(mocks.detectSubject).not.toHaveBeenCalled()
  })
})
