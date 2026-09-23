import { createClient } from '@supabase/supabase-js'
import { env } from './config.js'
import { HttpError } from './errors.js'
export async function authenticate(header?: string) {
  const match = header?.match(/^Bearer (.+)$/)
  if (!match) throw new HttpError(401, '请先登录', 'AUTH_REQUIRED')
  const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_PUBLISHABLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase.auth.getUser(match[1])
  if (error || !data.user) throw new HttpError(401, '登录已失效，请重新登录', 'SESSION_EXPIRED')
  // 邮箱和身份来自 Auth 服务，不信任客户端可修改的用户元数据。
  const user = data.user
  if (!user.email || !user.email_confirmed_at)
    throw new HttpError(403, '请先验证邮箱', 'EMAIL_UNVERIFIED')
  const avatar = user.user_metadata?.avatar_url ?? user.user_metadata?.picture
  const name = user.user_metadata?.full_name ?? user.user_metadata?.name
  return {
    id: user.id, email: user.email.toLowerCase(),
    providers: [...new Set(user.identities?.map(identity => identity.provider) ?? [user.app_metadata?.provider ?? 'email'])],
    avatarUrl: typeof avatar === 'string' && /^https:\/\//.test(avatar) ? avatar : null,
    suggestedName: typeof name === 'string' ? name.trim().slice(0,80) : '',
  }
}
