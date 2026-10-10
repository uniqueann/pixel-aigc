// @vitest-environment jsdom
import { StrictMode } from 'react'
import { App } from 'antd'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUserStore, type AccountContext } from '@/store/useUserStore'
import CreditRulesNotice from './CreditRulesNotice'
const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/cloud/client', () => ({ authEnabled: true, cloudRequest: mocks.request }))
const welcome = { initialCredits: 30, creditNoticeSeen: false, starterCardDismissed: false, analyticsEnabled: true, hasCreatedWork: false }
let owner: string
function login(userId: string, seen = false, credits = 30) {
  useUserStore.setState({ userId, account: { userId, welcome: { ...welcome, initialCredits: credits, creditNoticeSeen: seen } } as AccountContext })
}
function mount() { return render(<StrictMode><App><CreditRulesNotice key={owner} owner={owner} /></App></StrictMode>) }
beforeEach(() => {
  localStorage.clear(); mocks.request.mockReset().mockResolvedValue({ ...welcome, creditNoticeSeen: true })
  owner = crypto.randomUUID(); login(owner)
})
afterEach(cleanup)
describe('首次登录积分说明', () => {
  it('一句话说明真实赠送与结算，严格模式下也只提交一次', async () => {
    const view = mount()
    expect(screen.getByText('新账号赠送的 30 积分已到账；生成时先预扣积分，只按成功张数结算，失败或超时自动退回。')).toBeTruthy()
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1))
    expect(mocks.request.mock.calls[0][2]).toEqual({ creditNoticeSeen: true })
    fireEvent.click(document.querySelector('.ant-alert-close-icon')!)
    expect(screen.queryByRole('alert')).toBeNull()
    view.unmount(); login(owner); mount()
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('已读账号不显示，另一个账号仍有自己的说明，不把历史 100 分说成 30 分', () => {
    login(owner, true)
    const view = mount()
    expect(screen.queryByRole('alert')).toBeNull()
    view.unmount(); owner = crypto.randomUUID(); login(owner, false, 100); mount()
    expect(screen.getByText(/新账号赠送的 100 积分已到账/)).toBeTruthy()
  })
  it('云端已读保存失败仍不重复显示，本机记忆可在下次登录补交', async () => {
    mocks.request.mockRejectedValue(new Error('网络中断'))
    const view = mount()
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1))
    view.unmount(); login(owner); mount()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
