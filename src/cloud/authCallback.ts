import type { SupabaseClient } from '@supabase/supabase-js'

// 只接受邮件链接会用到的 type。SDK 的 EmailOtpType 还放行任意字符串，不能直接交给 verifyOtp。
export const emailLinkTypes = ['email', 'signup', 'recovery', 'magiclink', 'invite', 'email_change'] as const
export type EmailLinkType = (typeof emailLinkTypes)[number]

export type EmailLinkOutcome =
  | { kind: 'recovery'; userId: string }
  | { kind: 'continue' }
  | { kind: 'error'; message: string }

const invalidLink = '登录链接无效或已过期，请重新申请'

export function isEmailLinkType(value: string | null): value is EmailLinkType {
  return value !== null && (emailLinkTypes as readonly string[]).includes(value)
}

export function callbackHasLink(params: URLSearchParams): boolean {
  return params.has('code') || params.has('token_hash')
}

type EmailLinkVerifier = {
  auth: { verifyOtp: SupabaseClient['auth']['verifyOtp'] }
}

// code 与 token_hash 都只能用一次。模块级 Promise 挡住严格模式的重复挂载。
let codeExchange: Promise<unknown> | undefined
let emailLinkVerification: Promise<EmailLinkOutcome> | undefined

export function resetAuthCallbackForTests(): void {
  codeExchange = undefined
  emailLinkVerification = undefined
}

export function exchangeCodeOnce<T>(start: () => Promise<T>): Promise<T> {
  if (!codeExchange) codeExchange = start()
  return codeExchange as Promise<T>
}

export function verifyEmailLink(client: EmailLinkVerifier, params: URLSearchParams): Promise<EmailLinkOutcome> {
  const tokenHash = params.get('token_hash')
  const type = params.get('type')
  if (!tokenHash || !isEmailLinkType(type)) return Promise.resolve({ kind: 'error', message: invalidLink })
  if (!emailLinkVerification) {
    const verifiedType = type
    emailLinkVerification = Promise.resolve()
      .then(() => client.auth.verifyOtp({ type: verifiedType, token_hash: tokenHash }))
      .then(response => {
        if (response.error) throw response.error
        if (verifiedType === 'recovery') return { kind: 'recovery' as const, userId: response.data.user?.id ?? '' }
        return { kind: 'continue' as const }
      })
      .catch((err: unknown) => ({
        kind: 'error' as const,
        message: err instanceof Error ? err.message : '登录链接无效，请重试',
      }))
  }
  return emailLinkVerification
}
