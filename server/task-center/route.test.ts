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
})
