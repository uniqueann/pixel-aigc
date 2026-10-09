import { z } from 'zod'
import type { authenticate } from './auth.js'
import { runtimeScope, withIdentity } from './db.js'
import { HttpError } from './errors.js'
import { requireActive } from './members.js'
import { emailModelIdSchema, EMAIL_MODELS, EMAIL_PRICE_VERSION } from '../shared/email-models.js'
import { emailModelAvailability } from './email-provider.js'

type User = Awaited<ReturnType<typeof authenticate>>
export const parseProfile = (value: unknown) => emailModelIdSchema.parse(value)
export function modelProfiles() {
  return EMAIL_MODELS.map(model => ({ id: model.id, provider: model.provider, label: model.label,
    capability: 'email_assist' as const, credits: model.credits, priceVersion: EMAIL_PRICE_VERSION,
    ...emailModelAvailability(model.id) }))
}
export async function getModelSettings(user: User) {
  return withIdentity(user.id, user.email, async sql => {
    await requireActive(sql, user.id)
    const [preference] = await sql`select model_profile_id from aigc.model_preferences
      where user_id=${user.id} and scope=${runtimeScope()} and capability='email_assist'`
    return { defaultEmailModelId: preference?.model_profile_id ?? null }
  })
}
export async function handleModelRoute(user: User, method: string, path: string[], body: unknown) {
  const route = path.join('/')
  if (route === 'model-settings/deepseek' || route === 'model-settings/deepseek/test')
    throw new HttpError(410, '个人模型密钥配置已停用，请刷新后选择平台模型', 'BYOK_REMOVED')
  if (route === 'model-profiles' && method === 'GET') {
    await withIdentity(user.id, user.email, sql => requireActive(sql, user.id))
    return { items: modelProfiles() }
  }
  if (route === 'model-settings' && method === 'GET') return getModelSettings(user)
  if (route === 'model-settings/email' && method === 'PATCH') {
    const { defaultModelProfileId } = z.object({ defaultModelProfileId: emailModelIdSchema.nullable() }).strict().parse(body)
    await withIdentity(user.id, user.email, async sql => {
      await requireActive(sql, user.id)
      if (defaultModelProfileId === null) {
        await sql`delete from aigc.model_preferences where user_id=${user.id} and scope=${runtimeScope()} and capability='email_assist'`
      } else {
        await sql`insert into aigc.model_preferences(user_id,scope,capability,model_profile_id)
          values(${user.id},${runtimeScope()},'email_assist',${defaultModelProfileId})
          on conflict(user_id,scope,capability) do update set model_profile_id=excluded.model_profile_id,updated_at=now()`
      }
    })
    return getModelSettings(user)
  }
  throw new HttpError(404, '接口不存在', 'NOT_FOUND')
}
