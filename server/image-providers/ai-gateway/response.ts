import {
  parseOpenRouterImageResponse,
  type ParsedOpenRouterUsage,
} from '../openrouter/response.js'

export type ParsedAiGatewayUsage = ParsedOpenRouterUsage
export const parseAiGatewayImageResponse = parseOpenRouterImageResponse

/** Gateway 标价：输入约 $5/M，输出 $30/M。只在 Images API 没给 usage.cost 时用来估算。 */
export const GPT_IMAGE_INPUT_USD_PER_MILLION = 5
export const GPT_IMAGE_OUTPUT_USD_PER_MILLION = 30

export function gatewayImageTokenCost(inputTokens?: number, outputTokens?: number) {
  if (inputTokens === undefined && outputTokens === undefined) return undefined
  const raw = ((inputTokens ?? 0) * GPT_IMAGE_INPUT_USD_PER_MILLION
    + (outputTokens ?? 0) * GPT_IMAGE_OUTPUT_USD_PER_MILLION) / 1_000_000
  if (!Number.isFinite(raw) || raw < 0) return undefined
  return Math.round(raw * 1_000_000) / 1_000_000
}

function mimeFromImageBytes(bytes: Uint8Array, format: string) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) return 'image/webp'
  if (format === 'jpeg' || format === 'jpg') return 'image/jpeg'
  if (format === 'webp') return 'image/webp'
  return 'image/png'
}

function decodeBase64Image(raw: string) {
  const bytes = Buffer.from(raw.replace(/\s+/g, ''), 'base64')
  return bytes.byteLength ? Uint8Array.from(bytes) : undefined
}

/**
 * Images API 的 usage。优先用上游 cost（含 0）。
 * 没有 cost 但有 input/output token 时，按 $5/M、$30/M 估算。
 * 只有 total_tokens 时不估算，交给目录 vendorCost。
 */
export function readImagesApiUsage(payload: unknown): ParsedAiGatewayUsage | undefined {
  if (!isRecord(payload) || !isRecord(payload.usage)) return undefined
  const usage = payload.usage
  const promptTokens = finite(usage.prompt_tokens) ?? finite(usage.input_tokens)
  const completionTokens = finite(usage.completion_tokens) ?? finite(usage.output_tokens)
  const totalTokens = finite(usage.total_tokens)
  const upstream = finite(usage.cost)
  const cost = upstream ?? gatewayImageTokenCost(promptTokens, completionTokens)
  if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined && cost === undefined) {
    return undefined
  }
  return { promptTokens, completionTokens, totalTokens, cost }
}

/** GPT Image 走 Images API，结果在 data[].b64_json，不走 Chat Completions。 */
export function parseAiGatewayImagesApiResponse(payload: unknown): {
  images: Array<{ bytes: Uint8Array; mimeType: string }>
  usage?: ParsedAiGatewayUsage
} {
  const images: Array<{ bytes: Uint8Array; mimeType: string }> = []
  const root = isRecord(payload) ? payload : undefined
  const format = root && typeof root.output_format === 'string' ? root.output_format.trim().toLowerCase() : ''
  const data = root && Array.isArray(root.data) ? root.data : []
  for (const item of data) {
    if (!isRecord(item) || typeof item.b64_json !== 'string') continue
    const bytes = decodeBase64Image(item.b64_json)
    if (!bytes) continue
    images.push({ bytes, mimeType: mimeFromImageBytes(bytes, format) })
  }
  const usage = readImagesApiUsage(payload)
  return { images, ...(usage ? { usage } : {}) }
}

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

const RESULT_KEY = /^temporary\/ai-gateway-results\/(?:[0-9a-f-]{36}|(?:local|preview|production)\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36})\/[0-3]\.img$/i

export function aiGatewayResultUrl(key: string) {
  return `ai-gateway-object:${key}`
}

export function aiGatewayResultKey(url: string) {
  if (!url.startsWith('ai-gateway-object:')) return undefined
  const key = url.slice('ai-gateway-object:'.length)
  return RESULT_KEY.test(key) ? key : undefined
}
