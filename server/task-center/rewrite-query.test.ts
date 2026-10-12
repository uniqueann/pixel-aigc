import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '../http.js'

const calls = vi.hoisted(() => ({
  sidebar: vi.fn(async () => ({ items: [] })),
  history: vi.fn(async () => ({ items: [], nextCursor: null })),
  get: vi.fn(async () => ({
    source_kind: 'image_job',
    source_id: '00000000-0000-4000-8000-000000000081',
    request_id: '00000000-0000-4000-8000-000000000081',
    capability: 'variation',
    state: 'queued',
    completed_count: 0,
    requested_count: 1,
    billing_state: 'none',
    credits_reserved: 0,
    warnings: [],
    created_at: '2026-10-12T00:00:00.000Z',
    updated_at: '2026-10-12T00:00:00.000Z',
  })),
  detail: vi.fn(async () => ({ kind: 'detail' })),
  presentation: vi.fn(async () => ({ kind: 'presentation' })),
}))
vi.mock('../auth.js', () => ({
  authenticate: async () => ({
    id: '00000000-0000-4000-8000-000000000081',
    email: 'test@example.invalid',
    suggestedName: '测试',
    avatarUrl: null,
    providers: ['email'],
  }),
}))
vi.mock('./service.js', () => ({
  withTaskCenterRead: async (
    _user: unknown,
    action: (repository: {
      sidebar: typeof calls.sidebar
      history: typeof calls.history
      get: typeof calls.get
    }) => unknown,
  ) => action({ sidebar: calls.sidebar, history: calls.history, get: calls.get }),
  readTaskDetail: calls.detail,
  writePresentation: calls.presentation,
}))
vi.mock('sharp', () => ({ default: () => ({}) }))
import handler from '../handler.js'

const id = '00000000-0000-4000-8000-000000000081'
async function call(url: string, method = 'GET', body?: unknown) {
  const req = {
    headers: { authorization: 'Bearer test' },
    method,
    url,
    body,
  } as VercelRequest
  const response = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn(), end: vi.fn() }
  response.status.mockReturnValue(response)
  await handler(req, response as unknown as VercelResponse)
  return response
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('TASK_CENTER_ENABLED', 'true')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('任务中心经 Vercel 改写后的查询串', () => {
  it('侧栏、历史、按请求、详情和展示更新都成功', async () => {
    const sidebar = await call('/api/entry?__route=task-center&path=task-center&view=sidebar')
    expect(sidebar.status).toHaveBeenCalledWith(200)
    expect(calls.sidebar).toHaveBeenCalledOnce()
    const history = await call(
      '/api/entry?__route=task-center&path=task-center&view=history&state=all&tool=variation',
    )
    expect(history.status).toHaveBeenCalledWith(200)
    expect(calls.history).toHaveBeenCalledWith({
      tool: 'variation',
      state: 'all',
      limit: undefined,
      cursor: undefined,
    })
    const summary = await call(
      `/api/entry?__route=task-center/by-request/image_job/${id}&path=task-center&path=by-request&path=image_job&path=${id}`,
    )
    expect(summary.status).toHaveBeenCalledWith(200)
    expect(calls.get).toHaveBeenCalledWith('image_job', id, true)
    const detail = await call(
      `/api/entry?__route=task-center/image_job/${id}&path=task-center/image_job/${id}`,
    )
    expect(detail.status).toHaveBeenCalledWith(200)
    expect(calls.detail).toHaveBeenCalledWith(
      expect.objectContaining({ id }),
      'image_job',
      id,
    )
    const version = 'v1:' + 'a'.repeat(32)
    const presentation = await call(
      `/api/entry?__route=task-center/image_job/${id}/presentation&path=task-center&path=image_job&path=${id}&path=presentation`,
      'PATCH',
      { action: 'dismiss', outcomeVersion: version },
    )
    expect(presentation.status).toHaveBeenCalledWith(200)
    expect(calls.presentation).toHaveBeenCalledWith(
      expect.objectContaining({ id }),
      'image_job',
      id,
      'dismiss',
      version,
    )
  })

  it('未知参数仍返回 400，日志只有键名', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await call(
      '/api/entry?__route=task-center&path=task-center&view=sidebar&debug=secret-value',
    )
    expect(response.status).toHaveBeenCalledWith(400)
    expect(response.json).toHaveBeenCalledWith({
      error: '任务查询参数无效',
      code: 'INVALID_REQUEST',
      requestId: expect.any(String),
    })
    const logged = error.mock.calls.map((entry) => String(entry[0])).join('\n')
    expect(logged).toContain('任务查询参数无效')
    expect(logged).toContain('"keys":["debug"]')
    expect(logged).not.toContain('secret-value')
    expect(JSON.stringify(response.json.mock.calls)).not.toContain('secret-value')
    expect(JSON.stringify(response.json.mock.calls)).not.toContain('debug')
    expect(calls.sidebar).not.toHaveBeenCalled()
  })

  it('平台参数不能掩盖客户端自选环境', async () => {
    const response = await call(
      '/api/entry?__route=task-center&path=task-center&view=sidebar&scope=production',
    )
    expect(response.status).toHaveBeenCalledWith(400)
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: '任务环境由服务端确定', code: 'INVALID_REQUEST' }),
    )
    expect(calls.sidebar).not.toHaveBeenCalled()
  })
})
