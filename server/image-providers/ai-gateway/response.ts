import {
  parseOpenRouterImageResponse,
  type ParsedOpenRouterUsage,
} from '../openrouter/response.js'

export type ParsedAiGatewayUsage = ParsedOpenRouterUsage
export const parseAiGatewayImageResponse = parseOpenRouterImageResponse

export interface ParsedAiGatewayImagesResult {
  images: Array<{ bytes: Uint8Array; mimeType: string }>
  remoteUrl?: string
  usage?: ParsedAiGatewayUsage
  shape?: 'images-b64'
}

function sniffImageMime(bytes: Uint8Array) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return 'image/webp'
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif'
  return 'image/png'
}

function decodeBase64Image(raw: string) {
  const bytes = Buffer.from(raw.replace(/\s+/g, ''), 'base64')
  return bytes.byteLength ? Uint8Array.from(bytes) : undefined
}

function readImagesApiUsage(payload: unknown): ParsedAiGatewayUsage | undefined {
  if (!isRecord(payload) || !isRecord(payload.usage)) return undefined
  const usage = payload.usage
  const promptTokens = finite(usage.prompt_tokens) ?? finite(usage.input_tokens)
  const completionTokens = finite(usage.completion_tokens) ?? finite(usage.output_tokens)
  const totalTokens = finite(usage.total_tokens)
  const cost = finite(usage.cost)
  if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined && cost === undefined) {
    return undefined
  }
  return {
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(cost !== undefined ? { cost } : {}),
  }
}

/** Images API 的 data[].b64_json。没有 base64 时留下第一条 https 结果地址，由调用方下载。 */
export function parseAiGatewayImagesApiResponse(payload: unknown): ParsedAiGatewayImagesResult {
  const images: ParsedAiGatewayImagesResult['images'] = []
  let remoteUrl: string | undefined
  const root = isRecord(payload) ? payload : undefined
  const data = root && Array.isArray(root.data) ? root.data : []
  for (const item of data) {
    if (!isRecord(item)) continue
    if (typeof item.b64_json === 'string') {
      const bytes = decodeBase64Image(item.b64_json)
      if (bytes) images.push({ bytes, mimeType: sniffImageMime(bytes) })
      continue
    }
    if (typeof item.url !== 'string' || images.length || remoteUrl) continue
    const url = item.url.trim()
    const dataUrl = /^data:([^;,]+)?;base64,([\s\S]+)$/i.exec(url)
    if (dataUrl) {
      const bytes = decodeBase64Image(dataUrl[2] ?? '')
      const mimeType = (dataUrl[1] || 'image/png').trim().toLowerCase()
      if (bytes && mimeType.startsWith('image/')) images.push({ bytes, mimeType })
      continue
    }
    if (url.startsWith('https://')) remoteUrl = url
  }
  return {
    images,
    ...(remoteUrl && !images.length ? { remoteUrl } : {}),
    usage: readImagesApiUsage(payload),
    ...(images.length ? { shape: 'images-b64' as const } : {}),
  }
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
