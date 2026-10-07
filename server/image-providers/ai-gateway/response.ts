import {
  parseOpenRouterImageResponse,
  type ParsedOpenRouterUsage,
} from '../openrouter/response.js'

export type ParsedAiGatewayUsage = ParsedOpenRouterUsage
export const parseAiGatewayImageResponse = parseOpenRouterImageResponse

export interface StoredAiGatewayTask {
  key: string
  mimeType: string
  usage?: ParsedAiGatewayUsage
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function finite(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return undefined
}

export function encodeAiGatewayTask(task: StoredAiGatewayTask) {
  return `ag1.${Buffer.from(JSON.stringify(task)).toString('base64url')}`
}

export function decodeAiGatewayTask(providerTaskId: string): StoredAiGatewayTask | undefined {
  if (!providerTaskId.startsWith('ag1.')) return undefined
  try {
    const parsed: unknown = JSON.parse(Buffer.from(providerTaskId.slice(4), 'base64url').toString('utf8'))
    if (!isRecord(parsed)) return undefined
    if (typeof parsed.key !== 'string' || typeof parsed.mimeType !== 'string') return undefined
    const usage = isRecord(parsed.usage) ? {
      promptTokens: finite(parsed.usage.promptTokens),
      completionTokens: finite(parsed.usage.completionTokens),
      totalTokens: finite(parsed.usage.totalTokens),
      cost: finite(parsed.usage.cost),
    } : undefined
    const hasUsage = usage && (
      usage.promptTokens !== undefined
      || usage.completionTokens !== undefined
      || usage.totalTokens !== undefined
      || usage.cost !== undefined
    )
    return { key: parsed.key, mimeType: parsed.mimeType, ...(hasUsage ? { usage } : {}) }
  } catch {
    return undefined
  }
}

const RESULT_KEY = /^temporary\/ai-gateway-results\/[0-9a-f-]{36}\/\d+\.img$/i

export function aiGatewayResultUrl(key: string) {
  return `ai-gateway-object:${key}`
}

export function aiGatewayResultKey(url: string) {
  if (!url.startsWith('ai-gateway-object:')) return undefined
  const key = url.slice('ai-gateway-object:'.length)
  return RESULT_KEY.test(key) ? key : undefined
}
