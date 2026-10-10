// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAuthCallbackForTests } from './authCallback'
import AuthPages from './AuthPages'

const auth = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  resend: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  signInWithOAuth: vi.fn(),
}))

vi.mock('@/cloud/client', () => ({
  authEnabled: true,
  cloudConfigurationError: undefined,
  supabase: { auth },
}))

const replace = vi.fn()
const locationDescriptor = Object.getOwnPropertyDescriptor(window, 'location')

function visit(path: string) {
  const url = new URL(path, 'http://localhost:3000')
  Object.defineProperty(window, 'location', {
    configurable: true,
    enumerable: true,
    value: {
      pathname: url.pathname,
      search: url.search,
      hash: '',
      origin: url.origin,
      href: url.href,
      replace,
      assign: vi.fn(),
    },
  })
}

function signedIn(id: string) {
  return { data: { user: { id }, session: { access_token: 'token' } }, error: null }
}

describe('账号页邮箱链接', () => {
  beforeEach(() => {
    sessionStorage.clear()
    resetAuthCallbackForTests()
    replace.mockReset()
    auth.verifyOtp.mockReset()
    auth.exchangeCodeForSession.mockReset()
    auth.resend.mockReset()
    auth.resetPasswordForEmail.mockReset()
  })

  afterEach(() => {
    cleanup()
    if (locationDescriptor) Object.defineProperty(window, 'location', locationDescriptor)
    vi.restoreAllMocks()
  })

  it('没有 code 或 token_hash 时直接提示链接无效', () => {
    visit('/auth/callback')
    render(<AuthPages />)
    expect(screen.getByText('登录链接无效或已过期，请重新申请')).toBeTruthy()
    expect(auth.verifyOtp).not.toHaveBeenCalled()
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('只有 token_hash 时不提前判无效，并只验证一次', async () => {
    auth.verifyOtp.mockResolvedValue(signedIn('user-1'))
    visit('/auth/callback?token_hash=pkce_abc&type=email')
    render(<AuthPages />)
    expect(screen.queryByText('登录链接无效或已过期，请重新申请')).toBeNull()
    render(<AuthPages />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
    expect(auth.verifyOtp).toHaveBeenCalledTimes(1)
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: 'email', token_hash: 'pkce_abc' })
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('signup 进入注册前保存的站内地址', async () => {
    auth.verifyOtp.mockResolvedValue(signedIn('user-1'))
    sessionStorage.setItem('pixel-aigc-next', '/canvas/text-to-image?project=one')
    visit('/auth/callback?token_hash=pkce_abc&type=signup')
    render(<AuthPages />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/canvas/text-to-image?project=one'))
    expect(sessionStorage.getItem('pixel-aigc-recovery')).toBeNull()
  })

  it('站外 next 回落到首页', async () => {
    auth.verifyOtp.mockResolvedValue(signedIn('user-1'))
    sessionStorage.setItem('pixel-aigc-next', 'https://evil.example/phish')
    visit('/auth/callback?token_hash=pkce_abc&type=email')
    render(<AuthPages />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
  })

  it('recovery 写入恢复标记并进入设置新密码', async () => {
    auth.verifyOtp.mockResolvedValue(signedIn('user-1'))
    sessionStorage.setItem('pixel-aigc-next', '/help')
    visit('/auth/callback?next=/reset-password&token_hash=pkce_abc&type=recovery')
    render(<AuthPages />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/reset-password'))
    expect(sessionStorage.getItem('pixel-aigc-recovery')).toBe('user-1')
    expect(replace).not.toHaveBeenCalledWith('/help')
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('未知 type 不调用 verifyOtp', async () => {
    visit('/auth/callback?token_hash=pkce_abc&type=sms')
    render(<AuthPages />)
    expect(await screen.findByText('登录链接无效或已过期，请重新申请')).toBeTruthy()
    expect(auth.verifyOtp).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })

  it('verifyOtp 失败时停在回调页', async () => {
    auth.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: new Error('链接已过期') })
    visit('/auth/callback?token_hash=pkce_abc&type=email')
    render(<AuthPages />)
    expect(await screen.findByText('链接已过期')).toBeTruthy()
    expect(replace).not.toHaveBeenCalled()
  })

  it('带 error 的链接不验证', () => {
    visit('/auth/callback?error=access_denied&error_description=授权被拒绝&token_hash=pkce_abc&type=email&code=abc')
    render(<AuthPages />)
    expect(screen.getByText('授权被拒绝')).toBeTruthy()
    expect(auth.verifyOtp).not.toHaveBeenCalled()
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('code 分支仍按 next 区分恢复和登录，且优先于 token_hash', async () => {
    auth.exchangeCodeForSession.mockResolvedValue(signedIn('user-2'))
    sessionStorage.setItem('pixel-aigc-next', '/help/credits')
    visit('/auth/callback?code=oauth-code&token_hash=pkce_abc&type=email')
    render(<AuthPages />)
    render(<AuthPages />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/help/credits'))
    expect(auth.exchangeCodeForSession).toHaveBeenCalledTimes(1)
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('oauth-code')
    expect(auth.verifyOtp).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('pixel-aigc-recovery')).toBeNull()

    cleanup()
    resetAuthCallbackForTests()
    replace.mockClear()
    visit('/auth/callback?code=recovery-code&next=/reset-password')
    render(<AuthPages />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/reset-password'))
    expect(sessionStorage.getItem('pixel-aigc-recovery')).toBe('user-2')
    expect(auth.verifyOtp).not.toHaveBeenCalled()
  })

  it('验证邮箱页和重发提示不再指向 ContentUp', async () => {
    auth.resend.mockResolvedValue({ error: null })
    visit('/verify-email')
    render(<AuthPages />)
    expect(screen.getByText('注册邮件已发送。需要重发时输入邮箱。')).toBeTruthy()
    expect(document.body.textContent).not.toContain('ContentUp')
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'user@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '重发验证邮件' }))
    expect(await screen.findByText('如果该邮箱可用于此操作，请查收验证邮件。')).toBeTruthy()
    expect(document.body.textContent).not.toContain('ContentUp')
    expect(auth.resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'user@example.com',
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
  })

  it('找回密码提示不再要求同一浏览器，恢复地址保持不变', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: null })
    visit('/forgot-password')
    render(<AuthPages />)
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'user@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '发送恢复邮件' }))
    expect(await screen.findByText('如果该邮箱可用于此操作，请查收邮件。')).toBeTruthy()
    expect(document.body.textContent).not.toContain('发起请求的浏览器')
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('user@example.com', {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    })
  })
})
