import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Capability } from '@/types'
import { useUserStore, type AccountContext } from '@/store/useUserStore'

const mocks = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn(), account: vi.fn() }))
vi.mock('@/cloud/client', () => ({ authEnabled: true, cloudEnabled: false, cloudRequest: mocks.account }))
vi.mock('./client', () => ({ apiClient: { post: mocks.post, get: mocks.get } }))
import { createTask, getTask, getTaskByRequest } from './task'

const account: AccountContext = {
  userId: '11111111-1111-4111-8111-111111111111', credits: 20,
  email: 'test@example.com', emailVerified: true, displayName: '测试账号', avatarUrl: null,
  providers: ['email'], status: 'active', workspace: { id: 'workspace', name: '测试空间', type: 'personal', role: 'admin' },
}
const task = { id: 'text-task', capability: Capability.TextToImage, status: 'processing' }

describe('真实文生图积分刷新', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    useUserStore.getState().setAccount(account)
    mocks.post.mockResolvedValue(task)
    mocks.get.mockResolvedValue({ ...task, status: 'succeeded' })
    mocks.account.mockResolvedValue({ ...account, credits: 18 })
  })

  it('文生图提交后刷新预扣后的积分，终态查询再刷新结算余额', async () => {
    await createTask({ capability: Capability.TextToImage, requestId: 'request', params: { prompt: '雨夜城市', count: 1, resolution: '1k' } })
    await vi.waitFor(() => expect(useUserStore.getState().credits).toBe(18))
    mocks.account.mockResolvedValueOnce({ ...account, credits: 19 })
    await getTask('text-task')
    await vi.waitFor(() => expect(useUserStore.getState().credits).toBe(19))
    expect(mocks.account).toHaveBeenCalledTimes(2)
  })

  it('处理中轮询不反复刷新，找回原请求后刷新余额', async () => {
    mocks.get.mockResolvedValue(task)
    await getTask('text-task')
    expect(mocks.account).not.toHaveBeenCalled()
    await getTaskByRequest('original-request')
    await vi.waitFor(() => expect(useUserStore.getState().credits).toBe(18))
    expect(mocks.account).toHaveBeenCalledTimes(1)
  })

  it('换账号后到达的余额响应不覆盖新账号', async () => {
    let release!: (value: AccountContext) => void
    mocks.account.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    await createTask({ capability: Capability.TextToImage, requestId: 'request', params: {} })
    useUserStore.getState().setAccount({ ...account, userId: '22222222-2222-4222-8222-222222222222', credits: 50 })
    release({ ...account, credits: 18 })
    await Promise.resolve()
    expect(useUserStore.getState().credits).toBe(50)
  })
})
