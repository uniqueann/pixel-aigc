import { createClient } from '@supabase/supabase-js'
import { env } from './config.js'
import { HttpError } from './errors.js'
export async function authenticate(header?: string) {
  const match = header?.match(/^Bearer (.+)$/)
  if (!match) throw new HttpError(401, '请先登录')
  const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_PUBLISHABLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase.auth.getUser(match[1])
  if (error || !data.user) throw new HttpError(401, '登录已失效，请重新登录')
  // 邮箱和身份来自 Auth 服务，不信任客户端可修改的用户元数据。
  const user = data.user
  if (!user.email || !user.email_confirmed_at || !user.identities?.some(i => i.provider === 'google'))
    throw new HttpError(403, '请使用已验证的 Google 账号')
  return { id: user.id, email: user.email.toLowerCase() }
}
