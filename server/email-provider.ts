import { emailModel, type EmailModelId } from '../shared/email-models.js'
import { gatewayToken } from './ai-gateway-auth.js'
import { HttpError } from './errors.js'

export function emailModelAvailability(id: EmailModelId, env = process.env) {
  const model = emailModel(id)
  const enabled = env.EMAIL_ASSIST_ENABLED === 'true' && (model.provider === 'deepseek'
    ? env.DEEPSEEK_EMAIL_ENABLED === 'true' : env.AI_GATEWAY_EMAIL_ENABLED === 'true')
  const configured = Boolean(env.CRON_SECRET?.trim()) && (model.provider === 'deepseek' ? Boolean(env.DEEPSEEK_API_KEY?.trim())
    : Boolean(env.AI_GATEWAY_API_KEY?.trim() || env.VERCEL_OIDC_TOKEN?.trim() || env.VERCEL === '1'))
  return { available: enabled && configured, unavailableReason: !enabled ? '平台暂未开放此模型' : !configured ? '平台模型服务暂不可用' : null }
}

export class EmailProviderFailure extends Error {
  constructor(public code: string, message: string) { super(message) }
}
export async function generateEmail(modelId: EmailModelId, messages: { role: string; content: string }[]) {
  const profile = emailModel(modelId)
  const availability = emailModelAvailability(modelId)
  if (!availability.available) throw new HttpError(503, availability.unavailableReason!, 'MODEL_UNAVAILABLE')
  let token: string
  try { token = profile.provider === 'deepseek' ? process.env.DEEPSEEK_API_KEY!.trim() : await gatewayToken() }
  catch { throw new EmailProviderFailure('PROVIDER_AUTH', '平台模型鉴权暂不可用，请稍后重试') }
  if (!token) throw new EmailProviderFailure('PROVIDER_AUTH', '平台模型鉴权暂不可用，请稍后重试')
  let response: Response
  let payload: unknown
  try {
    response = await fetch(profile.provider === 'deepseek' ? 'https://api.deepseek.com/chat/completions' : 'https://ai-gateway.vercel.sh/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ model: profile.model, messages, temperature: 0.3, stream: false,
        max_tokens: profile.provider === 'deepseek' ? 1600 : 2048,
        ...(profile.provider === 'deepseek' ? { thinking: { type: 'disabled' } } : { reasoning_effort: 'low' }) }),
      signal: AbortSignal.timeout(profile.provider === 'deepseek' ? 40000 : 70000),
    })
    payload = await response.json().catch(() => null)
  } catch { throw new EmailProviderFailure('PROVIDER_TIMEOUT', '平台模型请求超时或连接失败，请稍后重试') }
  if ([401, 403].includes(response.status)) throw new EmailProviderFailure('PROVIDER_AUTH', '平台模型服务鉴权异常，请稍后重试')
  if (response.status === 402) throw new EmailProviderFailure('PROVIDER_BALANCE', '平台模型服务额度暂不可用，请稍后重试')
  if (response.status === 429) throw new EmailProviderFailure('PROVIDER_RATE_LIMIT', '平台模型服务繁忙，请稍后重试')
  if (!response.ok) throw new EmailProviderFailure('PROVIDER_UNAVAILABLE', '平台模型服务暂不可用，请稍后重试')
  const parsed = payload as { id?: string; choices?: { finish_reason?: string; message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } } } | null
  const choice = parsed?.choices?.[0]
  if (choice?.finish_reason === 'length') throw new EmailProviderFailure('RESULT_TRUNCATED', '输出被截断，积分将返还，请缩短邮件内容后重试')
  const resultText = typeof choice?.message?.content === 'string' ? choice.message.content.trim() : ''
  if (choice?.finish_reason !== 'stop' || !resultText) throw new EmailProviderFailure('PROVIDER_RESPONSE', '模型未返回完整邮件文本，积分将返还')
  const usage = parsed?.usage
  return { resultText, tokenUsage: { promptTokens: Number(usage?.prompt_tokens) || 0,
    completionTokens: Number(usage?.completion_tokens) || 0, totalTokens: Number(usage?.total_tokens) || 0,
    cachedTokens: Number(usage?.prompt_tokens_details?.cached_tokens) || 0,
    reasoningTokens: Number(usage?.completion_tokens_details?.reasoning_tokens) || 0 },
    vendor: { provider: profile.provider, model: profile.model, generationId: typeof parsed?.id === 'string' ? parsed.id : null } }
}
