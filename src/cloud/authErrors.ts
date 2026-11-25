import { i18n } from '@/i18n'

const AUTH_ERROR_CODES = new Set([
  'invalid_credentials',
  'email_not_confirmed',
  'email_exists',
  'user_already_exists',
  'weak_password',
  'same_password',
  'otp_expired',
  'email_address_invalid',
  'email_address_not_authorized',
  'signup_disabled',
  'email_provider_disabled',
  'provider_disabled',
  'over_email_send_rate_limit',
  'over_request_rate_limit',
  'request_timeout',
  'session_expired',
  'session_not_found',
  'refresh_token_not_found',
  'user_banned',
  'user_not_found',
  'validation_failed',
  'captcha_failed',
  'unexpected_failure',
  'bad_code_verifier',
  'flow_state_not_found',
  'flow_state_expired',
  'bad_oauth_state',
  'bad_oauth_callback',
  'recovery_session_expired',
  'invalid_auth_link',
])

export class LocalAuthError extends Error {
  constructor(public code: string, message: string) {
    super(message)
    this.name = 'LocalAuthError'
  }
}

export type AuthField = 'email' | 'password' | 'confirm'

// 能明确归属到某个字段的错误，直接显示在字段下方。
const AUTH_ERROR_FIELDS: Record<string, AuthField | AuthField[]> = {
  invalid_credentials: ['email', 'password'],
  email_not_confirmed: 'email',
  email_exists: 'email',
  user_already_exists: 'email',
  email_address_invalid: 'email',
  email_address_not_authorized: 'email',
  over_email_send_rate_limit: 'email',
  weak_password: 'password',
  same_password: 'password',
}

// 少数错误没有 code，只能按 Supabase 的英文文案兜底匹配。
const MESSAGE_PATTERNS: Array<[string, string]> = [
  ['invalid login credentials', 'invalid_credentials'],
  ['email not confirmed', 'email_not_confirmed'],
  ['user already registered', 'user_already_exists'],
  ['password should be at least', 'weak_password'],
  ['password is too weak', 'weak_password'],
  ['new password should be different', 'same_password'],
  ['email link is invalid or has expired', 'otp_expired'],
  ['token has expired or is invalid', 'otp_expired'],
  ['unable to validate email address', 'email_address_invalid'],
  ['for security purposes, you can only request this after', 'over_email_send_rate_limit'],
]

const MESSAGE_FIELD_PATTERNS: Array<[string, AuthField | AuthField[]]> = [
  ['invalid login credentials', ['email', 'password']],
  ['email not confirmed', 'email'],
  ['user already registered', 'email'],
  ['password should be at least', 'password'],
  ['password is too weak', 'password'],
  ['new password should be different', 'password'],
  ['unable to validate email address', 'email'],
  ['for security purposes, you can only request this after', 'email'],
]

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : ''
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : ''
}

function toFields(value: AuthField | AuthField[]): AuthField[] {
  return Array.isArray(value) ? value : [value]
}

function translateAuthCode(code: string): string | undefined {
  return AUTH_ERROR_CODES.has(code) ? i18n.t(`auth:errors.${code}` as never) : undefined
}

export function authErrorMessage(error: unknown, fallback: string): string {
  const code = errorCode(error)
  const message = errorMessage(error)

  const mapped = code ? translateAuthCode(code) : undefined
  if (mapped) return mapped
  if (error instanceof LocalAuthError) return translateAuthCode(error.code) ?? error.message
  const lower = message.toLowerCase()
  const matched = MESSAGE_PATTERNS.find(([pattern]) => lower.includes(pattern))
  if (matched) return translateAuthCode(matched[1]) ?? fallback
  if (message) console.error('[auth] Unmapped error:', error)
  return fallback
}

export function authErrorFields(error: unknown): AuthField[] {
  const code = errorCode(error)
  if (code && AUTH_ERROR_FIELDS[code]) return toFields(AUTH_ERROR_FIELDS[code])
  const lower = errorMessage(error).toLowerCase()
  const matched = MESSAGE_FIELD_PATTERNS.find(([pattern]) => lower.includes(pattern))
  return matched ? toFields(matched[1]) : []
}
