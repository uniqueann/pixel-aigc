import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  submit: vi.fn(), list: vi.fn(), load: vi.fn(), byRequest: vi.fn(), peek: vi.fn(), remove: vi.fn(),
}))
vi.mock('./service.js', () => ({
  submitImageTask: mocks.submit, listImageTasks: mocks.list, loadImageTask: mocks.load,
  loadImageTaskByRequest: mocks.byRequest, peekImageTask: mocks.peek, deleteImageTask: mocks.remove,
}))
import { handleImageTaskRoute } from './route.js'
const user = { id: '00000000-0000-4000-8000-000000000001', email: 'alice@example.com', suggestedName: 'A', avatarUrl: null, providers: ['email'] }
beforeEach(() => vi.clearAllMocks())

describe('图片任务列表路由', () => {
  it('按文生图能力和页码筛选，未筛选的内部调用保持兼容', async () => {
    await handleImageTaskRoute(user, 'GET', ['tasks'], undefined, new URLSearchParams('capability=text_to_image&page=2'))
    expect(mocks.list).toHaveBeenLastCalledWith(user, 2, 'text_to_image')
    await handleImageTaskRoute(user, 'GET', ['tasks'], undefined, new URLSearchParams())
    expect(mocks.list).toHaveBeenLastCalledWith(user, 1, undefined)
  })
  it('拒绝视频能力和无效页码，不查询任务历史', async () => {
    for (const query of ['capability=text_to_video', 'capability=text_to_image&page=0'])
      await expect(handleImageTaskRoute(user, 'GET', ['tasks'], undefined, new URLSearchParams(query))).rejects.toThrow()
    expect(mocks.list).not.toHaveBeenCalled()
  })
})
