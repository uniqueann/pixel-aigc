// Supabase Auth 的英文错误不直接展示给用户；按错误码映射成中文，未知错误保留原始信息到控制台。
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: '邮箱或密码不正确，请检查后重试，或使用“忘记密码”。',
  email_not_confirmed: '邮箱尚未验证，请查收验证邮件，或重新发送验证邮件。',
  email_exists: '该邮箱已注册，请直接登录或找回密码。',
  user_already_exists: '该邮箱已注册，请直接登录或找回密码。',
  weak_password: '密码强度不足，请使用 8–128 位字符。',
  same_password: '新密码不能与当前密码相同。',
  otp_expired: '验证链接已过期，请重新申请。',
  email_address_invalid: '邮箱地址无效，请检查后重试。',
  email_address_not_authorized: '该邮箱地址不在允许注册的范围内。',
  signup_disabled: '当前暂未开放注册，请联系管理员。',
  email_provider_disabled: '邮箱登录暂未开放，请使用 Google 登录。',
  provider_disabled: '该登录方式暂未开放，请使用其他方式登录。',
  over_email_send_rate_limit: '发送过于频繁，请稍后再试。',
  over_request_rate_limit: '操作过于频繁，请稍后再试。',
  request_timeout: '请求超时，请检查网络后重试。',
  session_expired: '登录状态已失效，请重新登录。',
  session_not_found: '登录状态已失效，请重新登录。',
  refresh_token_not_found: '登录状态已失效，请重新登录。',
  user_banned: '当前账号已被停用，请联系管理员。',
  user_not_found: '账号不存在，请检查邮箱或先注册。',
  validation_failed: '提交的信息格式不正确，请检查后重试。',
  captcha_failed: '人机验证失败，请重试。',
  unexpected_failure: '服务暂时不可用，请稍后重试。',
  bad_code_verifier: '登录链接无效，请重新申请。',
  flow_state_not_found: '登录链接无效或已过期，请重新申请。',
  flow_state_expired: '登录链接已过期，请重新申请。',
  bad_oauth_state: '登录请求已失效，请重新发起登录。',
  bad_oauth_callback: '登录回调无效，请重新发起登录。',
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

const hasChinese = (value: string) => /[一-鿿]/.test(value)

export function authErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : ''
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : ''

  if (code && AUTH_ERROR_MESSAGES[code]) return AUTH_ERROR_MESSAGES[code]
  // 本项目自己抛出的中文校验信息优先保留，例如密码长度与恢复会话失效。
  if (hasChinese(message)) return message
  const lower = message.toLowerCase()
  const matched = MESSAGE_PATTERNS.find(([pattern]) => lower.includes(pattern))
  if (matched) return AUTH_ERROR_MESSAGES[matched[1]]
  if (message) console.error('[auth] 未映射的错误：', error)
  return fallback
}
