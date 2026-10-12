import { beforeEach, describe, expect, it, vi } from 'vitest'
const calls = vi.hoisted(() => ({
  sidebar: vi.fn(),
  history: vi.fn(),
  get: vi.fn(),
  detail: vi.fn(),
  presentation: vi.fn(),
  read: vi.fn(),
}))
vi.mock('./service.js', () => ({
  withTaskCenterRead: calls.read,
  readTaskDetail: calls.detail,
  writePresentation: calls.presentation,
}))
import { handleTaskCenterRoute } from './route.js'
const user = {
    id: '00000000-0000-4000-8000-000000000081',
    email: 'test@example.invalid',
  },
  id = user.id
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('TASK_CENTER_ENABLED', 'true')
  calls.read.mockImplementation((_user, action) =>
    action({ sidebar: calls.sidebar, history: calls.history, get: calls.get }),
  )
})
describe('任务中心路由边界', () => {
  it('关闭时明确503，不接数据库或旧业务接口', async () => {
    vi.stubEnv('TASK_CENTER_ENABLED', 'false')
    await expect(
      handleTaskCenterRoute(
        user,
        'GET',
        ['task-center'],
        null,
        new URLSearchParams(),
      ),
    ).rejects.toMatchObject({ status: 503, code: 'TASK_CENTER_DISABLED' })
    expect(calls.read).not.toHaveBeenCalled()
  })
  it('客户端不能自选环境；非法来源、编号、分页返回参数错误', async () => {
    await expect(
      handleTaskCenterRoute(
        user,
        'GET',
        ['task-center'],
        null,
        new URLSearchParams('scope=production'),
      ),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      handleTaskCenterRoute(
        user,
        'GET',
        ['task-center', 'other', id],
        null,
        new URLSearchParams(),
      ),
    ).rejects.toThrow()
    await expect(
      handleTaskCenterRoute(
        user,
        'GET',
        ['task-center', 'image_job', 'x'],
        null,
        new URLSearchParams(),
      ),
    ).rejects.toThrow()
    expect(calls.read).not.toHaveBeenCalled()
    expect(calls.detail).not.toHaveBeenCalled()
  })
  it('集合、详情与展示操作分别走只读或独立写入端口', async () => {
    await handleTaskCenterRoute(
      user,
      'GET',
      ['task-center'],
      null,
      new URLSearchParams('view=sidebar'),
    )
    expect(calls.sidebar).toHaveBeenCalledOnce()
    await handleTaskCenterRoute(
      user,
      'GET',
      ['task-center'],
      null,
      new URLSearchParams('view=history&tool=variation&limit=20'),
    )
    expect(calls.history).toHaveBeenCalledWith({
      tool: 'variation',
      limit: '20',
      state: undefined,
      cursor: undefined,
    })
    await handleTaskCenterRoute(
      user,
      'GET',
      ['task-center', 'image_job', id],
      null,
      new URLSearchParams(),
    )
    expect(calls.detail).toHaveBeenCalledWith(user, 'image_job', id)
    await handleTaskCenterRoute(
      user,
      'PATCH',
      ['task-center', 'image_job', id, 'presentation'],
      { action: 'dismiss', outcomeVersion: 'v1:' + 'a'.repeat(32) },
      new URLSearchParams(),
    )
    expect(calls.presentation).toHaveBeenCalledWith(
      user,
      'image_job',
      id,
      'dismiss',
      'v1:' + 'a'.repeat(32),
    )
    expect(calls.read).toHaveBeenCalledTimes(2)
  })
  it('改写注入的平台参数不影响各任务路由，未知参数仍拒绝并只记录键名', async () => {
    const version = 'v1:' + 'a'.repeat(32)
    await handleTaskCenterRoute(
      user,
      'GET',
      ['task-center'],
      null,
      new URLSearchParams('__route=task-center&path=task-center&view=sidebar'),
    )
    expect(calls.sidebar).toHaveBeenCalledOnce()
    await handleTaskCenterRoute(
      user,
      'GET',
      ['task-center'],
      null,
      new URLSearchParams(
        '__route=task-center&path=task-center&view=history&state=all&tool=variation',
      ),
    )
    expect(calls.history).toHaveBeenCalledWith({
      tool: 'variation',
      state: 'all',
      limit: undefined,
      cursor: undefined,
    })
    calls.get.mockResolvedValue({
      source_kind: 'image_job',
      source_id: id,
      request_id: id,
      capability: 'variation',
      state: 'queued',
      completed_count: 0,
      requested_count: 1,
      billing_state: 'none',
      credits_reserved: 0,
      warnings: [],
      created_at: '2026-10-12T00:00:00.000Z',
      updated_at: '2026-10-12T00:00:00.000Z',
    })
    await expect(
      handleTaskCenterRoute(
        user,
        'GET',
        ['task-center', 'by-request', 'image_job', id],
        null,
        new URLSearchParams([
          ['__route', `task-center/by-request/image_job/${id}`],
          ['path', 'task-center'],
          ['path', 'by-request'],
          ['path', 'image_job'],
          ['path', id],
        ]),
      ),
    ).resolves.toEqual(expect.objectContaining({ sourceKind: 'image_job', sourceId: id }))
    expect(calls.get).toHaveBeenCalledWith('image_job', id, true)
    await handleTaskCenterRoute(
      user,
      'GET',
      ['task-center', 'image_job', id],
      null,
      new URLSearchParams(
        `__route=task-center/image_job/${id}&path=task-center/image_job/${id}`,
      ),
    )
    expect(calls.detail).toHaveBeenCalledWith(user, 'image_job', id)
    await handleTaskCenterRoute(
      user,
      'PATCH',
      ['task-center', 'image_job', id, 'presentation'],
      { action: 'seen', outcomeVersion: version },
      new URLSearchParams([
        ['__route', `task-center/image_job/${id}/presentation`],
        ['path', 'task-center'],
        ['path', 'image_job'],
        ['path', id],
        ['path', 'presentation'],
      ]),
    )
    expect(calls.presentation).toHaveBeenCalledWith(user, 'image_job', id, 'seen', version)
    await expect(
      handleTaskCenterRoute(
        user,
        'GET',
        ['task-center'],
        null,
        new URLSearchParams('__route=task-center&path=task-center&scope=production&view=sidebar'),
      ),
    ).rejects.toMatchObject({ status: 400, message: '任务环境由服务端确定' })
    await expect(
      handleTaskCenterRoute(
        user,
        'GET',
        ['task-center', 'image_job', id],
        null,
        new URLSearchParams(
          `__route=task-center/image_job/${id}&path=task-center&debug=secret-value&extra=1`,
        ),
      ),
    ).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_REQUEST',
      message: '任务查询参数无效',
      log: { keys: ['debug', 'extra'] },
    })
    expect(calls.detail).toHaveBeenCalledTimes(1)
  })
})
