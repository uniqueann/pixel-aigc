// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUserStore, type AccountContext } from '@/store/useUserStore'
import { acknowledgeWelcome, flushUploadEvent, readLocalWelcome, saveWelcomeState, trackFirstUpload, uploadToolForPath } from './client'
const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/cloud/client', () => ({ authEnabled: true, cloudRequest: mocks.request }))
let owner: string
const welcome = { initialCredits: 30, creditNoticeSeen: false, starterCardDismissed: false, analyticsEnabled: true, hasCreatedWork: false }
beforeEach(() => {
  vi.restoreAllMocks(); mocks.request.mockReset().mockResolvedValue(welcome); localStorage.clear()
  owner = crypto.randomUUID()
  useUserStore.setState({ userId: owner, account: { userId: owner, welcome: { ...welcome } } as AccountContext })
})
describe('首次上传与欢迎状态', () => {
  it('上传成功去重，只发送事件和工具名', async () => {
    trackFirstUpload(owner, 'bg-remove'); trackFirstUpload(owner, 'repaint')
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1))
    await flushUploadEvent(owner)
    trackFirstUpload(owner, 'email-batch')
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.request).toHaveBeenCalledWith('/activation/events', 'POST', { event: 'first_upload', tool: 'bg-remove' }, expect.objectContaining({ expectedUserId: owner }))
  })
  it('失败保留首个工具，网络恢复可补交；存储受限仍可提交', async () => {
    mocks.request.mockRejectedValueOnce(new Error('网络中断'))
    trackFirstUpload(owner, 'watermark')
    await flushUploadEvent(owner)
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1))
    await new Promise(resolve => setTimeout(resolve, 0))
    await flushUploadEvent(owner)
    expect(mocks.request).toHaveBeenCalledTimes(2)
    expect(mocks.request.mock.calls[1][2]).toEqual({ event: 'first_upload', tool: 'watermark' })
    owner = crypto.randomUUID(); useUserStore.setState({ userId: owner, account: null })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('存储受限') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('存储受限') })
    trackFirstUpload(owner, 'bg-remove')
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(3))
  })
  it('刷新后继续使用另一个工具，仍补交此前首次上传的工具', async () => {
    localStorage.setItem(`pixel:activation:v1:${window.location.origin}:local:${owner}:upload`, 'watermark')
    trackFirstUpload(owner, 'repaint')
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1))
    expect(mocks.request.mock.calls[0][2]).toEqual({ event: 'first_upload', tool: 'watermark' })
  })
  it('无账号、统计关闭、账号切换后的迟到上传不记录', () => {
    trackFirstUpload(null, 'bg-remove')
    trackFirstUpload('其他账号', 'bg-remove')
    useUserStore.setState({ account: { userId: owner, welcome: { ...welcome, analyticsEnabled: false } } as AccountContext })
    trackFirstUpload(owner, 'bg-remove')
    expect(mocks.request).not.toHaveBeenCalled()
  })
  it('提示关闭按账号隔离，旧账号的迟到响应不能修改新账号', async () => {
    let finish!: (value: typeof welcome) => void
    mocks.request.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    acknowledgeWelcome(owner, { starterCardDismissed: true })
    expect(readLocalWelcome(owner)).toEqual({ starterCardDismissed: true })
    const other = crypto.randomUUID()
    useUserStore.setState({ userId: other, account: { userId: other, welcome } as AccountContext })
    finish({ ...welcome, starterCardDismissed: true }); await Promise.resolve()
    expect(readLocalWelcome(other)).toEqual({})
    expect(useUserStore.getState().account?.welcome?.starterCardDismissed).toBe(false)
  })
  it('提示保存不会恢复已经关闭的数据统计', async () => {
    useUserStore.setState({ account: { userId: owner, welcome: { ...welcome, analyticsEnabled: false } } as AccountContext })
    await saveWelcomeState(owner, { creditNoticeSeen: true })
    expect(useUserStore.getState().account?.welcome?.analyticsEnabled).toBe(false)
  })
  it('同账号同域名下的记忆与迟到响应也按运行环境隔离', async () => {
    let finish!: (value: typeof welcome) => void
    mocks.request.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    acknowledgeWelcome(owner, { starterCardDismissed: true })
    useUserStore.setState({ account: { userId: owner, runtimeScope: 'production', welcome } as AccountContext })
    expect(readLocalWelcome(owner)).toEqual({})
    finish({ ...welcome, starterCardDismissed: true }); await Promise.resolve()
    expect(useUserStore.getState().account?.welcome?.starterCardDismissed).toBe(false)
  })
  it('仅识别工具入口，单个邮件输入及未知页面不冒充上传', () => {
    expect(uploadToolForPath('/toolbox/bg-remove', '')).toBe('bg-remove')
    expect(uploadToolForPath('/canvas/text-to-image', '')).toBe('text-to-image')
    expect(uploadToolForPath('/email', '?mode=batch')).toBe('email-batch')
    expect(uploadToolForPath('/email', '?mode=single')).toBeUndefined()
    expect(uploadToolForPath('/help/repaint', '')).toBeUndefined()
    expect(uploadToolForPath('/toolbox/unknown', '')).toBeUndefined()
  })
})
