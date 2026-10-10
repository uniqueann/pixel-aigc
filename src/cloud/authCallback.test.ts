import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import {
  callbackHasLink,
  emailLinkTypes,
  exchangeCodeOnce,
  resetAuthCallbackForTests,
  verifyEmailLink,
} from './authCallback'

function verifier(verifyOtp = vi.fn()) {
  return { client: { auth: { verifyOtp } } as unknown as SupabaseClient, verifyOtp }
}

describe('邮箱链接回调', () => {
  it('没有 code 也没有 token_hash 时视为无效链接', () => {
    expect(callbackHasLink(new URLSearchParams(''))).toBe(false)
    expect(callbackHasLink(new URLSearchParams('next=/reset-password'))).toBe(false)
    expect(callbackHasLink(new URLSearchParams('code=abc'))).toBe(true)
    expect(callbackHasLink(new URLSearchParams('token_hash=pkce_abc&type=email'))).toBe(true)
  })

  it('email 与 signup 完成登录，recovery 返回用户编号', async () => {
    for (const type of emailLinkTypes) {
      resetAuthCallbackForTests()
      const { client, verifyOtp } = verifier()
      verifyOtp.mockResolvedValue({ data: { user: { id: 'user-1' }, session: {} }, error: null })
      const outcome = await verifyEmailLink(client, new URLSearchParams(`token_hash=pkce_abc&type=${type}`))
      expect(verifyOtp).toHaveBeenCalledTimes(1)
      expect(verifyOtp).toHaveBeenCalledWith({ type, token_hash: 'pkce_abc' })
      if (type === 'recovery') expect(outcome).toEqual({ kind: 'recovery', userId: 'user-1' })
      else expect(outcome).toEqual({ kind: 'continue' })
    }
  })

  it('同一 token_hash 只验证一次', async () => {
    resetAuthCallbackForTests()
    const { client, verifyOtp } = verifier()
    let resolveOtp: (value: unknown) => void = () => {}
    verifyOtp.mockReturnValue(new Promise(resolve => { resolveOtp = resolve }))
    const params = new URLSearchParams('token_hash=pkce_abc&type=recovery')
    const first = verifyEmailLink(client, params)
    const second = verifyEmailLink(client, params)
    expect(verifyOtp).not.toHaveBeenCalled()
    resolveOtp({ data: { user: { id: 'user-1' }, session: {} }, error: null })
    await expect(first).resolves.toEqual({ kind: 'recovery', userId: 'user-1' })
    await expect(second).resolves.toEqual({ kind: 'recovery', userId: 'user-1' })
    expect(verifyOtp).toHaveBeenCalledTimes(1)
  })

  it('验证失败后不再重试，并显示接口错误', async () => {
    resetAuthCallbackForTests()
    const { client, verifyOtp } = verifier()
    verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: new Error('链接已过期') })
    const params = new URLSearchParams('token_hash=pkce_abc&type=email')
    await expect(verifyEmailLink(client, params)).resolves.toEqual({ kind: 'error', message: '链接已过期' })
    await expect(verifyEmailLink(client, params)).resolves.toEqual({ kind: 'error', message: '链接已过期' })
    expect(verifyOtp).toHaveBeenCalledTimes(1)
  })

  it('拒绝空 token、缺失或未知 type', async () => {
    resetAuthCallbackForTests()
    const { client, verifyOtp } = verifier()
    for (const search of ['token_hash=&type=email', 'token_hash=pkce_abc', 'token_hash=pkce_abc&type=sms', 'token_hash=pkce_abc&type=Email']) {
      await expect(verifyEmailLink(client, new URLSearchParams(search))).resolves.toEqual({
        kind: 'error',
        message: '登录链接无效或已过期，请重新申请',
      })
    }
    expect(verifyOtp).not.toHaveBeenCalled()
  })

  it('恢复链接没有用户编号时仍标记为空', async () => {
    resetAuthCallbackForTests()
    const { client, verifyOtp } = verifier()
    verifyOtp.mockResolvedValue({ data: { user: null, session: {} }, error: null })
    await expect(verifyEmailLink(client, new URLSearchParams('token_hash=pkce_abc&type=recovery'))).resolves.toEqual({
      kind: 'recovery',
      userId: '',
    })
  })

  it('code 交换也只发起一次', async () => {
    resetAuthCallbackForTests()
    const start = vi.fn().mockResolvedValue('session')
    const first = exchangeCodeOnce(start)
    const second = exchangeCodeOnce(() => Promise.resolve('other'))
    expect(start).toHaveBeenCalledTimes(1)
    await expect(first).resolves.toBe('session')
    await expect(second).resolves.toBe('session')
  })
})
