import type { ImageResolution, NormalizedImageRequest } from '../../../shared/image-generation.js'
import { DRAGONCODE_RATIOS, GPT_IMAGE_26_MODEL, ratioValue } from '../../../shared/image-models.js'
import type { MappedImageRequest } from '../types.js'
import type { ParsedAiGatewayUsage } from './response.js'

/**
 * OpenAI Images API 约束，GPT Image 2.6 与 2.5 共用。
 * https://developers.openai.com/api/docs/guides/image-generation
 * 宽高为 16 的倍数，长短边不超过 3:1，单边不超过 3840，总像素 655360–8294400。
 */
export const GPT_IMAGE_EDGE_MULTIPLE = 16
export const GPT_IMAGE_MIN_PIXELS = 655_360
export const GPT_IMAGE_MAX_PIXELS = 8_294_400
export const GPT_IMAGE_MAX_EDGE = 3840
export const GPT_IMAGE_MAX_ASPECT = 3
export const GPT_IMAGE_MAX_REFERENCE_IMAGES = 16
export const GPT_IMAGE_QUALITY = 'medium' as const
/** Gateway 目录价：输入 $5/M、输出 $30/M。https://ai-gateway.vercel.sh/v1/models 的 openai/gpt-image-2.6-flare。 */
export const GPT_IMAGE_INPUT_USD_PER_TOKEN = 0.000_005
export const GPT_IMAGE_OUTPUT_USD_PER_TOKEN = 0.000_03

const LONG_EDGE: Record<ImageResolution, number> = {
  '1k': 1024,
  '2k': 2048,
  // 4K 档不能用 4096：单边上限是 3840。正方形还会被总像素上限收到 2880。
  '4k': GPT_IMAGE_MAX_EDGE,
}

/**
 * OpenAI 公开计算器里 GPT Image 2.6 的输出 token 估计（medium）。
 * 质量基线与 2.6 乘数来自文档页 GptImageTokenCalculator，不是实测 usage。
 */
const OUTPUT_BASE = { medium: 24 } as const
const OUTPUT_MULTIPLIER = { medium: 3.3 } as const

export const GPT_IMAGE_CAPABILITIES = {
  operations: ['text_to_image', 'image_edit', 'variation'] as const,
  supportsMask: false,
  maxRefImages: GPT_IMAGE_MAX_REFERENCE_IMAGES,
  maxN: 1,
  sizeMode: 'ratio' as const,
  ratios: [...DRAGONCODE_RATIOS],
  resolutions: ['1k', '2k', '4k'] as const,
  acceptsInput: ['url', 'data'] as Array<'url' | 'data'>,
  execution: 'async' as const,
}

export function isGptImageModel(model: string | undefined) {
  return model === GPT_IMAGE_26_MODEL
}

export function gptImageOutputTokens(width: number, height: number) {
  const base = OUTPUT_BASE.medium
  const long = Math.max(width, height)
  const short = Math.min(width, height)
  const ratio = base / (long / short)
  const floored = Math.floor(ratio)
  const rounded = ratio - floored === 0.5 ? floored + (floored % 2) : Math.round(ratio)
  const patches = (width >= height ? base : rounded) * (width >= height ? rounded : base)
  const raw = Math.ceil(patches * (2_000_000 + width * height) / 4_000_000)
  return Math.round(raw * OUTPUT_MULTIPLIER.medium)
}

export function gptImageTokenCost(usage: { promptTokens?: number; completionTokens?: number }) {
  if (usage.promptTokens === undefined && usage.completionTokens === undefined) return undefined
  const cost = (usage.promptTokens ?? 0) * GPT_IMAGE_INPUT_USD_PER_TOKEN
    + (usage.completionTokens ?? 0) * GPT_IMAGE_OUTPUT_USD_PER_TOKEN
  if (!Number.isFinite(cost) || cost < 0) return undefined
  return Math.round(cost * 1_000_000) / 1_000_000
}

export function withGptImageTokenCost(usage: ParsedAiGatewayUsage | undefined) {
  if (!usage || usage.cost !== undefined) return usage
  const cost = gptImageTokenCost(usage)
  return cost === undefined ? usage : { ...usage, cost }
}

function roundToMultiple(value: number, multiple: number) {
  return Math.max(multiple, Math.round(value / multiple) * multiple)
}

export function isAllowedGptImageSize(size: string) {
  const match = /^(\d+)x(\d+)$/.exec(size)
  if (!match) return false
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isInteger(width) || !Number.isInteger(height)) return false
  if (width % GPT_IMAGE_EDGE_MULTIPLE !== 0 || height % GPT_IMAGE_EDGE_MULTIPLE !== 0) return false
  if (width < GPT_IMAGE_EDGE_MULTIPLE || height < GPT_IMAGE_EDGE_MULTIPLE) return false
  if (width > GPT_IMAGE_MAX_EDGE || height > GPT_IMAGE_MAX_EDGE) return false
  const pixels = width * height
  if (pixels < GPT_IMAGE_MIN_PIXELS || pixels > GPT_IMAGE_MAX_PIXELS) return false
  return Math.max(width, height) / Math.min(width, height) <= GPT_IMAGE_MAX_ASPECT + 1e-9
}

export function fitGptImageSize(width: number, height: number, resolution: ImageResolution) {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  let aspect = safeWidth / safeHeight
  if (aspect > GPT_IMAGE_MAX_ASPECT) aspect = GPT_IMAGE_MAX_ASPECT
  if (aspect < 1 / GPT_IMAGE_MAX_ASPECT) aspect = 1 / GPT_IMAGE_MAX_ASPECT
  const targetLong = LONG_EDGE[resolution]
  let best: { width: number; height: number; score: number } | undefined
  for (let long = GPT_IMAGE_EDGE_MULTIPLE; long <= GPT_IMAGE_MAX_EDGE; long += GPT_IMAGE_EDGE_MULTIPLE) {
    const fitted = aspect >= 1
      ? { width: long, height: roundToMultiple(long / aspect, GPT_IMAGE_EDGE_MULTIPLE) }
      : { width: roundToMultiple(long * aspect, GPT_IMAGE_EDGE_MULTIPLE), height: long }
    const size = `${fitted.width}x${fitted.height}`
    if (!isAllowedGptImageSize(size)) continue
    const longEdge = Math.max(fitted.width, fitted.height)
    const aspectError = Math.abs(Math.log(fitted.width / fitted.height) - Math.log(aspect))
    const score = Math.abs(longEdge - targetLong) * 1_000 + aspectError
    if (!best || score < best.score) best = { ...fitted, score }
  }
  const chosen = best ?? { width: 1024, height: 1024 }
  return { width: chosen.width, height: chosen.height, size: `${chosen.width}x${chosen.height}` }
}

function requestPixels(req: NormalizedImageRequest) {
  const size = req.target.size
  if (size && size.width > 0 && size.height > 0) return size
  const primary = req.images[0]
  if (primary?.width && primary.height) return { width: primary.width, height: primary.height }
  if (req.target.aspectRatio && (DRAGONCODE_RATIOS as readonly string[]).includes(req.target.aspectRatio)) {
    const [width, height] = req.target.aspectRatio.split(':').map(Number)
    return { width, height }
  }
  return { width: 1, height: 1 }
}

export interface GptImageGenerationsBody {
  model: string
  prompt: string
  size: string
  quality: typeof GPT_IMAGE_QUALITY
  n: 1
  response_format: 'b64_json'
}

export interface GptImageEditsBody extends GptImageGenerationsBody {
  images: Array<{ image_url: string }>
}

/** 无参考图走 generations，有参考图走 edits。质量固定 medium，不接受调用方改高。 */
export function buildGptImageRequest(input: {
  model: string
  prompt: string
  images: Array<{ url: string }>
  size: string
}): { path: 'images/generations' | 'images/edits'; body: GptImageGenerationsBody | GptImageEditsBody } {
  const shared: GptImageGenerationsBody = {
    model: input.model,
    prompt: input.prompt,
    size: input.size,
    quality: GPT_IMAGE_QUALITY,
    n: 1,
    response_format: 'b64_json',
  }
  if (!input.images.length) return { path: 'images/generations', body: shared }
  return {
    path: 'images/edits',
    body: { ...shared, images: input.images.map(image => ({ image_url: image.url })) },
  }
}

export function mapGptImageRequest(req: NormalizedImageRequest, model: string = GPT_IMAGE_26_MODEL): MappedImageRequest {
  const count = Math.min(4, Math.max(1, Math.round(req.count || 1)))
  const resolution: ImageResolution = req.target.resolution === '1k' || req.target.resolution === '4k'
    ? req.target.resolution
    : '2k'
  const pixels = requestPixels(req)
  const fitted = fitGptImageSize(pixels.width, pixels.height, resolution)
  return {
    providerParams: {
      model,
      size: fitted.size,
      width: fitted.width,
      height: fitted.height,
      resolution,
      quality: GPT_IMAGE_QUALITY,
      n: 1,
    },
    fanOut: count,
    warnings: [],
    expectedAspect: ratioValue(`${fitted.width}:${fitted.height}`) || fitted.width / fitted.height,
  }
}
