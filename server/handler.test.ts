import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from './http'
const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), sql: vi.fn(), verify: vi.fn() }))
vi.mock('./auth', () => ({ authenticate: mocks.authenticate }))
vi.mock('./db', () => ({ withIdentity: async (_id: string, _email: string, fn: (sql: unknown) => Promise<unknown>) => fn(Object.assign(mocks.sql, { json: (v: unknown) => v })) }))
vi.mock('./storage', () => ({ verifyAndPromote: mocks.verify, signRead: vi.fn(), signUpload: vi.fn() }))
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
  mocks.authenticate.mockResolvedValue({ id: 'owner',email: 'owner@example.com' })
  mocks.sql.mockImplementation(async (parts: TemplateStringsArray) => {
    const query=parts.join('?')
    if (query.includes('select status')) return [{ status: 'active' }]
    if (query.includes('select * from aigc.projects')) return [{ id: 'p',revision: 3 }]
    if (query.includes('update aigc.projects')) return [{ revision: 4 }]
    return []
  })
})
describe('API 认证、版本和写入边界', () => {
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
})
