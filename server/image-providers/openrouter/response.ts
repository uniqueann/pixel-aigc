export interface ParsedOpenRouterImage {
  bytes: Uint8Array
  mimeType: string
}

export interface ParsedOpenRouterUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  cost?: number
}

export type OpenRouterImageShape = 'message-images' | 'message-content' | 'inline-data'

export interface ParsedOpenRouterResult {
  images: ParsedOpenRouterImage[]
  usage?: ParsedOpenRouterUsage
  shape?: OpenRouterImageShape
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function finite(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return undefined
}

function decodeBase64(raw: string) {
  const bytes = Buffer.from(raw.replace(/\s+/g, ''), 'base64')
  return bytes.byteLength ? Uint8Array.from(bytes) : undefined
}

function fromDataUrl(url: string): ParsedOpenRouterImage | undefined {
  const match = /^data:([^;,]+)?;base64,([\s\S]+)$/i.exec(url.trim())
  if (!match) return undefined
  const mimeType = (match[1] || 'image/png').trim().toLowerCase()
  if (!mimeType.startsWith('image/')) return undefined
  const bytes = decodeBase64(match[2] ?? '')
  if (!bytes) return undefined
  return { bytes, mimeType }
}

function fromInline(value: unknown): ParsedOpenRouterImage | undefined {
  if (!isRecord(value)) return undefined
  const data = typeof value.data === 'string' ? value.data : undefined
  if (!data) return undefined
  const mimeRaw = value.mime_type ?? value.mimeType
  const mimeType = typeof mimeRaw === 'string' && mimeRaw.trim() ? mimeRaw.trim().toLowerCase() : 'image/png'
  if (!mimeType.startsWith('image/')) return undefined
  const bytes = decodeBase64(data)
  if (!bytes) return undefined
  return { bytes, mimeType }
}

function imageFromPart(part: unknown): { image?: ParsedOpenRouterImage; inline: boolean } {
  if (typeof part === 'string') return { image: fromDataUrl(part), inline: false }
  if (!isRecord(part)) return { inline: false }
  const imageUrl = isRecord(part.image_url) ? part.image_url : isRecord(part.imageUrl) ? part.imageUrl : undefined
  const url = imageUrl && typeof imageUrl.url === 'string' ? imageUrl.url : undefined
  if (url) return { image: fromDataUrl(url), inline: false }
  if (typeof part.url === 'string') return { image: fromDataUrl(part.url), inline: false }
  if (typeof part.b64_json === 'string') {
    const bytes = decodeBase64(part.b64_json)
    if (!bytes) return { inline: false }
    return { image: { bytes, mimeType: 'image/png' }, inline: false }
  }
  const inline = part.inline_data ?? part.inlineData
  const image = fromInline(inline)
  return { image, inline: !!image }
}

function pushImage(images: ParsedOpenRouterImage[], image: ParsedOpenRouterImage | undefined) {
  if (!image) return false
  images.push(image)
  return true
}

export function parseOpenRouterImageResponse(payload: unknown): ParsedOpenRouterResult {
  const images: ParsedOpenRouterImage[] = []
  let shape: OpenRouterImageShape | undefined
  let sawInline = false
  const root = isRecord(payload) ? payload : undefined
  const choices = root && Array.isArray(root.choices) ? root.choices : []
  for (const choice of choices) {
    if (!isRecord(choice) || !isRecord(choice.message)) continue
    const message = choice.message
    if (Array.isArray(message.images)) {
      for (const part of message.images) {
        const parsed = imageFromPart(part)
        if (pushImage(images, parsed.image)) {
          if (parsed.inline) sawInline = true
          else if (!shape) shape = 'message-images'
        }
      }
    }
    if (!images.length && Array.isArray(message.content)) {
      for (const part of message.content) {
        const parsed = imageFromPart(part)
        if (pushImage(images, parsed.image)) {
          if (parsed.inline) sawInline = true
          else if (!shape) shape = 'message-content'
        }
      }
    }
  }
  if (sawInline && !shape) shape = 'inline-data'
  return { images, usage: readOpenRouterUsage(payload), ...(shape ? { shape } : {}) }
}

export function readOpenRouterUsage(payload: unknown): ParsedOpenRouterUsage | undefined {
  if (!isRecord(payload) || !isRecord(payload.usage)) return undefined
  const usage = payload.usage
  const promptTokens = finite(usage.prompt_tokens)
  const completionTokens = finite(usage.completion_tokens)
  const totalTokens = finite(usage.total_tokens)
  const cost = finite(usage.cost)
  if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined && cost === undefined) {
    return undefined
  }
  return { promptTokens, completionTokens, totalTokens, cost }
}

export interface StoredOpenRouterTask {
  key: string
  mimeType: string
  usage?: ParsedOpenRouterUsage
}

export function encodeOpenRouterTask(task: StoredOpenRouterTask) {
  return `or1.${Buffer.from(JSON.stringify(task)).toString('base64url')}`
}

export function decodeOpenRouterTask(providerTaskId: string): StoredOpenRouterTask | undefined {
  if (!providerTaskId.startsWith('or1.')) return undefined
  try {
    const parsed: unknown = JSON.parse(Buffer.from(providerTaskId.slice(4), 'base64url').toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const record = parsed as Record<string, unknown>
    if (typeof record.key !== 'string' || typeof record.mimeType !== 'string') return undefined
    const usage = isRecord(record.usage) ? {
      promptTokens: finite(record.usage.promptTokens),
      completionTokens: finite(record.usage.completionTokens),
      totalTokens: finite(record.usage.totalTokens),
      cost: finite(record.usage.cost),
    } : undefined
    const hasUsage = usage && (usage.promptTokens !== undefined || usage.completionTokens !== undefined || usage.totalTokens !== undefined || usage.cost !== undefined)
    return { key: record.key, mimeType: record.mimeType, ...(hasUsage ? { usage } : {}) }
  } catch {
    return undefined
  }
}

const RESULT_KEY = /^temporary\/openrouter-results\/[0-9a-f-]{36}\/\d+\.img$/i

export function openRouterResultUrl(key: string) {
  return `openrouter-object:${key}`
}

export function openRouterResultKey(url: string) {
  if (!url.startsWith('openrouter-object:')) return undefined
  const key = url.slice('openrouter-object:'.length)
  return RESULT_KEY.test(key) ? key : undefined
}
