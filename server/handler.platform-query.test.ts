import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from './http.js'

const handleTaskCenterRoute = vi.hoisted(() => vi.fn(async () => ({ ok: true })))
vi.mock('./task-center/route.js', () => ({
  handleTaskCenterRoute,
  taskCenterEnabled: () => true,
}))
vi.mock('./auth.js', () => ({
  authenticate: async () => ({
    id: 'owner',
    email: 'owner@example.com',
    suggestedName: '测试',
    avatarUrl: null,
    providers: ['email'],
  }),
}))
vi.mock('sharp', () => ({ default: () => ({}) }))
import handler from './handler.js'

function invocation(index = 0) {
  return handleTaskCenterRoute.mock.calls[index] as unknown as [
    { id: string },
    string,
    string[],
    unknown,
    URLSearchParams,
  ]
}
async function call(url: string) {
  const req = { headers: { authorization: 'Bearer test' }, method: 'GET', url } as VercelRequest
  const response = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn(), end: vi.fn() }
  response.status.mockReturnValue(response)
  await handler(req, response as unknown as VercelResponse)
  return response
}

describe('入口在交给任务中心前剥离平台查询参数', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  it('不把 __route 和 path 传给路由', async () => {
    const response = await call('/api/entry?__route=task-center&path=task-center&view=sidebar')
    expect(response.status).toHaveBeenCalledWith(200)
    expect([...invocation()[4].entries()]).toEqual([['view', 'sidebar']])
  })
  it('详情路径上重复的 path 段也不会进入路由', async () => {
    const id = '00000000-0000-4000-8000-000000000081'
    await call(
      `/api/entry?__route=task-center/image_job/${id}&path=task-center&path=image_job&path=${id}`,
    )
    expect([...invocation()[4].keys()]).toEqual([])
    expect(invocation()[2]).toEqual(['task-center', 'image_job', id])
  })
})
