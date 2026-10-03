import { createHmac, timingSafeEqual } from 'node:crypto'
import { SEEDANCE_VIDEO_MODEL } from '../../../shared/video-models.js'

export function seedanceConfig(env = process.env) {
  const apiKey = env.ARK_API_KEY?.trim()
  const baseUrl = (env.SEEDANCE_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '')
  const callbackBase = env.VIDEO_PUBLIC_BASE_URL?.replace(/\/$/, '')
  const callbackSecret = env.SEEDANCE_CALLBACK_SECRET
  if (!apiKey || !callbackBase || !callbackSecret) return null
  try { if (new URL(baseUrl).protocol !== 'https:' || new URL(callbackBase).protocol !== 'https:') return null }
  catch { return null }
  return { apiKey, baseUrl, callbackBase, callbackSecret, model: SEEDANCE_VIDEO_MODEL.model }
}

export function videoGenerationAvailable(env = process.env) {
  return env.VIDEO_GENERATION_ENABLED === 'true' && !!seedanceConfig(env)
    && ['AIGC_DATABASE_URL', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'VIDEO_CRON_SECRET'].every(key => !!env[key])
}

export function callbackToken(jobId: string, scope: string, secret = process.env.SEEDANCE_CALLBACK_SECRET ?? '') {
  return createHmac('sha256', secret).update(`${scope}:${jobId}`).digest('hex')
}

export function validCallbackToken(jobId: string, scope: string, token: string) {
  if (!process.env.SEEDANCE_CALLBACK_SECRET || !/^[a-f0-9]{64}$/.test(token)) return false
  return timingSafeEqual(Buffer.from(token), Buffer.from(callbackToken(jobId, scope)))
}

export function videoCallbackUrl(jobId: string, scope: string) {
  const config = seedanceConfig()
  if (!config) throw new Error('Seedance 回调配置不完整')
  const url = new URL('/api/internal/video-jobs-callback', config.callbackBase)
  url.searchParams.set('jobId', jobId)
  url.searchParams.set('scope', scope)
  url.searchParams.set('token', callbackToken(jobId, scope, config.callbackSecret))
  return url.toString()
}
