import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { authenticate } from './auth.js'
import { runtimeScope, withIdentity, type Transaction } from './db.js'
import { HttpError } from './errors.js'
import { env } from './config.js'

type User = Awaited<ReturnType<typeof authenticate>>
export const MODEL_PROFILES = [
  { id: 'deepseek:deepseek-flash', provider: 'deepseek', label: 'DeepSeek Flash', capability: 'email_assist' },
  { id: 'deepseek:deepseek-v4-pro', provider: 'deepseek', label: 'DeepSeek V4 Pro', capability: 'email_assist' },
] as const
export type ModelProfileId = typeof MODEL_PROFILES[number]['id']
const profileSchema = z.enum(['deepseek:deepseek-flash', 'deepseek:deepseek-v4-pro'])
const keySchema = z.object({ apiKey: z.string().trim().min(10).max(512) }).strict()

function encryptionKey() {
  const key = Buffer.from(env('AIGC_CREDENTIAL_KEY_V1'), 'base64')
  if (key.length !== 32) throw new Error('AIGC_CREDENTIAL_KEY_V1 必须是 32 字节 Base64')
  return key
}

function associatedData(userId: string) {
  return Buffer.from(`${userId}:${runtimeScope()}:deepseek`, 'utf8')
}

export function encryptKey(apiKey: string, userId: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  cipher.setAAD(associatedData(userId))
  const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final(), cipher.getAuthTag()])
  return { iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64') }
}

export function decryptKey(row: { iv: string; ciphertext: string; key_version: number }, userId: string) {
  if (row.key_version !== 1) throw new Error('不支持的凭据加密版本')
  const iv = Buffer.from(row.iv, 'base64')
  const value = Buffer.from(row.ciphertext, 'base64')
  if (iv.length !== 12 || value.length < 17) throw new Error('模型凭据已损坏')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv)
  decipher.setAAD(associatedData(userId))
  decipher.setAuthTag(value.subarray(-16))
  return Buffer.concat([decipher.update(value.subarray(0, -16)), decipher.final()]).toString('utf8')
}

export async function requireActive(sql: Transaction, userId: string) {
  const [member] = await sql`select status from aigc.members where user_id=${userId}`
  if (!member) throw new HttpError(403, '当前账号尚未初始化', 'MEMBER_UNAVAILABLE')
  if (member.status !== 'active') throw new HttpError(403, '当前账号已被停用', 'MEMBER_DISABLED')
}

async function verifyDeepSeekKey(apiKey: string) {
  let response: Response
  try {
    response = await fetch('https://api.deepseek.com/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    })
  } catch {
    throw new HttpError(503, 'DeepSeek 暂时无法连接，请稍后重试', 'PROVIDER_UNAVAILABLE')
  }
  if (response.status === 401) throw new HttpError(400, 'DeepSeek API Key 无效，请检查后重试', 'INVALID_PROVIDER_KEY')
  if (!response.ok) throw new HttpError(503, 'DeepSeek 暂时无法验证密钥，请稍后重试', 'PROVIDER_UNAVAILABLE')
  const payload: unknown = await response.json().catch(() => null)
  if (!payload || typeof payload !== 'object' || !('data' in payload) || !Array.isArray(payload.data))
    throw new HttpError(503, 'DeepSeek 模型列表响应异常', 'PROVIDER_UNAVAILABLE')
  const available = new Set(payload.data.map((item: unknown) => item && typeof item === 'object' && 'id' in item ? item.id : null))
  if (!available.has('deepseek-flash')) throw new HttpError(503, 'DeepSeek Flash 暂时不可用', 'MODEL_UNAVAILABLE')
}

export async function getModelSettings(user: User) {
  return withIdentity(user.id, user.email, async sql => {
    await requireActive(sql, user.id)
    const [credential] = await sql`select key_tail,verification_status,verified_at from aigc.model_credentials
      where user_id=${user.id} and scope=${runtimeScope()} and provider='deepseek'`
    const [preference] = await sql`select model_profile_id from aigc.model_preferences
      where user_id=${user.id} and scope=${runtimeScope()} and capability='email_assist'`
    return {
      deepseek: { configured: !!credential, keyTail: credential?.key_tail ?? null,
        verificationStatus: credential?.verification_status ?? null, verifiedAt: credential?.verified_at ?? null },
      defaultEmailModelId: preference?.model_profile_id ?? 'deepseek:deepseek-flash',
    }
  })
}

export async function handleModelRoute(user: User, method: string, path: string[], body: unknown) {
  if (path.join('/') === 'model-profiles' && method === 'GET') {
    await withIdentity(user.id, user.email, sql => requireActive(sql, user.id))
    return { items: MODEL_PROFILES }
  }
  if (path.join('/') === 'model-settings' && method === 'GET') return getModelSettings(user)
  if (path.join('/') === 'model-settings/deepseek' && method === 'PUT') {
    const { apiKey } = keySchema.parse(body)
    await withIdentity(user.id, user.email, sql => requireActive(sql, user.id))
    await verifyDeepSeekKey(apiKey)
    const encrypted = encryptKey(apiKey, user.id)
    await withIdentity(user.id, user.email, async sql => {
      await requireActive(sql, user.id)
      await sql`insert into aigc.model_credentials(user_id,scope,provider,ciphertext,iv,key_version,key_tail,verification_status,verified_at)
        values(${user.id},${runtimeScope()},'deepseek',${encrypted.ciphertext},${encrypted.iv},1,${apiKey.slice(-4)},'valid',now())
        on conflict(user_id,scope,provider) do update set ciphertext=excluded.ciphertext,iv=excluded.iv,key_version=excluded.key_version,
        key_tail=excluded.key_tail,verification_status='valid',verified_at=now(),updated_at=now()`
    })
    return getModelSettings(user)
  }
  if (path.join('/') === 'model-settings/deepseek' && method === 'DELETE') {
    await withIdentity(user.id, user.email, async sql => {
      await requireActive(sql, user.id)
      await sql`delete from aigc.model_credentials where user_id=${user.id} and scope=${runtimeScope()} and provider='deepseek'`
    })
    return getModelSettings(user)
  }
  if (path.join('/') === 'model-settings/deepseek/test' && method === 'POST') {
    const credential = await getDeepSeekCredential(user)
    try { await verifyDeepSeekKey(credential.apiKey) }
    catch (error) {
      if (error instanceof HttpError && error.code === 'INVALID_PROVIDER_KEY')
        await markDeepSeekKeyInvalid(user, credential.ciphertext)
      throw error
    }
    await withIdentity(user.id, user.email, async sql => {
      await sql`update aigc.model_credentials set verification_status='valid',verified_at=now(),updated_at=now()
        where user_id=${user.id} and scope=${runtimeScope()} and provider='deepseek'`
    })
    return getModelSettings(user)
  }
  if (path.join('/') === 'model-settings/email' && method === 'PATCH') {
    const { defaultModelProfileId } = z.object({ defaultModelProfileId: profileSchema }).strict().parse(body)
    await withIdentity(user.id, user.email, async sql => {
      await requireActive(sql, user.id)
      await sql`insert into aigc.model_preferences(user_id,scope,capability,model_profile_id)
        values(${user.id},${runtimeScope()},'email_assist',${defaultModelProfileId})
        on conflict(user_id,scope,capability) do update set model_profile_id=excluded.model_profile_id,updated_at=now()`
    })
    return getModelSettings(user)
  }
  throw new HttpError(404, '接口不存在', 'NOT_FOUND')
}

export async function getDeepSeekCredential(user: User) {
  return withIdentity(user.id, user.email, async sql => {
    await requireActive(sql, user.id)
    const [row] = await sql`select ciphertext,iv,key_version,verification_status from aigc.model_credentials
      where user_id=${user.id} and scope=${runtimeScope()} and provider='deepseek'`
    if (!row) throw new HttpError(409, '请先在模型与密钥设置中添加 DeepSeek API Key', 'MODEL_KEY_REQUIRED')
    if (row.verification_status === 'invalid') throw new HttpError(409, 'DeepSeek API Key 已失效，请重新设置', 'MODEL_KEY_INVALID')
    try { return { apiKey: decryptKey(row as { iv: string; ciphertext: string; key_version: number }, user.id), ciphertext: String(row.ciphertext) } }
    catch { throw new HttpError(503, '模型密钥暂时不可用，请联系管理员', 'CREDENTIAL_UNAVAILABLE') }
  })
}

export async function markDeepSeekKeyInvalid(user: User, ciphertext: string) {
  await withIdentity(user.id, user.email, async sql => {
    await sql`update aigc.model_credentials set verification_status='invalid',updated_at=now()
      where user_id=${user.id} and scope=${runtimeScope()} and provider='deepseek' and ciphertext=${ciphertext}`
  })
}

export function parseProfile(value: unknown): ModelProfileId {
  return profileSchema.parse(value)
}
