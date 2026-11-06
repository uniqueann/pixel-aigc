import type { ImageResolution, NormalizedImageRequest } from '../../../shared/image-generation.js'
import {
  DRAGONCODE_RATIOS,
  GPT_IMAGE_26_MODEL,
  nearestRatio,
} from '../../../shared/image-models.js'
import type { MappedImageRequest } from '../types.js'

/**
 * OpenAI GPT Image 自定义尺寸约束（Images API，gpt-image-2 及之后，含 2.6 Flare）。
 * 宽高都能被 16 整除，长短边之比不超过 3:1，单边不超过 3840，
 * 总像素在 655360 和 8294400 之间。高于 2560x1440 的分辨率官方标为实验性。
 * https://developers.openai.com/api/docs/guides/image-generation
 */
export const GPT_IMAGE_MIN_PIXELS = 655_360
export const GPT_IMAGE_MAX_PIXELS = 8_294_400
export const GPT_IMAGE_MAX_EDGE = 3840
export const GPT_IMAGE_MAX_RATIO = 3
export const GPT_IMAGE_QUALITY = 'medium' as const

/** 与 GPT Image 2 相同的比例，不含 auto。auto 会丢掉 1K/2K/4K 档位。 */
export const GPT_IMAGE_RATIOS = DRAGONCODE_RATIOS

export const GPT_IMAGE_CAPABILITIES = {
  operations: ['image_edit', 'text_to_image', 'variation'] as const,
  supportsMask: false,
  maxRefImages: 16,
  maxN: 1,
  sizeMode: 'ratio' as const,
  ratios: [...GPT_IMAGE_RATIOS],
  resolutions: ['1k', '2k', '4k'] as const,
  acceptsInput: ['url', 'data'] as Array<'url' | 'data'>,
  execution: 'async' as const,
}

const LONG_EDGE: Record<ImageResolution, number> = {
  '1k': 1024,
  '2k': 2048,
  '4k': 3840,
}

function snap16(value: number) {
  return Math.max(16, Math.round(value / 16) * 16)
}

export function isGptImagePixelSize(size: string) {
  const match = /^(\d+)x(\d+)$/.exec(size)
  if (!match) return false
  const width = Number(match[1])
  const height = Number(match[2])
  if (!width || !height || width % 16 !== 0 || height % 16 !== 0) return false
  if (width > GPT_IMAGE_MAX_EDGE || height > GPT_IMAGE_MAX_EDGE) return false
  const pixels = width * height
  if (pixels < GPT_IMAGE_MIN_PIXELS || pixels > GPT_IMAGE_MAX_PIXELS) return false
  return Math.max(width, height) / Math.min(width, height) <= GPT_IMAGE_MAX_RATIO + 1e-9
}

function isGptRatio(value: string): value is typeof GPT_IMAGE_RATIOS[number] {
  return (GPT_IMAGE_RATIOS as readonly string[]).includes(value)
}

/**
 * 把目录比例和 1K/2K/4K 收成 OpenAI 的 WIDTHxHEIGHT。
 * 先贴近该档长边（1K=1024、2K=2048、4K=3840），再在合法尺寸里选长边最接近的一档。
 * 4K 正方形不能用 3840，因为像素超过上限，会落到 2880x2880。
 */
export function gptImagePixelSize(ratio: string, resolution: ImageResolution) {
  const [ratioWidth, ratioHeight] = ratio.split(':').map(Number)
  if (!ratioWidth || !ratioHeight) throw new Error(`无法识别的图片比例 ${ratio}`)
  const aspect = ratioWidth / ratioHeight
  const landscape = aspect >= 1
  const targetLong = LONG_EDGE[resolution]
  let best: { width: number; height: number; edgeDelta: number; ratioError: number } | undefined
  for (let long = 16; long <= GPT_IMAGE_MAX_EDGE; long += 16) {
    const short = snap16(landscape ? long / aspect : long * aspect)
    const width = landscape ? long : short
    const height = landscape ? short : long
    const size = `${width}x${height}`
    if (!isGptImagePixelSize(size)) continue
    if (landscape && width < height) continue
    if (!landscape && height < width) continue
    const edgeDelta = Math.abs(Math.max(width, height) - targetLong)
    const ratioError = Math.abs(Math.log(width / height) - Math.log(aspect))
    if (!best || edgeDelta < best.edgeDelta || (edgeDelta === best.edgeDelta && ratioError < best.ratioError)) {
      best = { width, height, edgeDelta, ratioError }
    }
  }
  if (!best) throw new Error(`无法为 ${ratio} ${resolution} 计算图片尺寸`)
  return { width: best.width, height: best.height }
}

function requestPixels(req: NormalizedImageRequest) {
  const primary = req.images[0]
  if (primary?.width && primary.height) return { width: primary.width, height: primary.height }
  if (req.target.size?.width && req.target.size.height) return req.target.size
  if (req.target.aspectRatio && isGptRatio(req.target.aspectRatio)) {
    const [width, height] = req.target.aspectRatio.split(':').map(Number)
    return { width, height }
  }
  return { width: 1, height: 1 }
}

export interface GptImageApiBody {
  model: string
  prompt: string
  size: string
  quality: typeof GPT_IMAGE_QUALITY
  n: 1
  images?: Array<{ image_url: string }>
}

export interface GptImageApiRequest {
  endpoint: 'images/generations' | 'images/edits'
  body: GptImageApiBody
}

/** 无参考图走 generations；有参考图走 edits。quality 固定 medium，避免 auto/high 把 token 放大。 */
export function buildGptImageApiRequest(input: {
  model: string
  prompt: string
  size: string
  images: Array<{ url: string }>
}): GptImageApiRequest {
  const shared = {
    model: input.model,
    prompt: input.prompt,
    size: input.size,
    quality: GPT_IMAGE_QUALITY,
    n: 1 as const,
  }
  if (input.images.length) {
    return {
      endpoint: 'images/edits',
      body: { ...shared, images: input.images.map(image => ({ image_url: image.url })) },
    }
  }
  return { endpoint: 'images/generations', body: shared }
}

export function mapGptImageRequest(req: NormalizedImageRequest, model: string = GPT_IMAGE_26_MODEL): MappedImageRequest {
  const count = Math.min(4, Math.max(1, Math.round(req.count || 1)))
  const resolution: ImageResolution = req.target.resolution === '1k' || req.target.resolution === '4k'
    ? req.target.resolution
    : '2k'
  const pixels = requestPixels(req)
  const aspectRatio = req.target.aspectRatio && isGptRatio(req.target.aspectRatio)
    ? req.target.aspectRatio
    : nearestRatio(pixels.width, pixels.height, GPT_IMAGE_RATIOS)
  const sized = gptImagePixelSize(aspectRatio, resolution)
  return {
    providerParams: {
      model,
      size: `${sized.width}x${sized.height}`,
      quality: GPT_IMAGE_QUALITY,
      resolution,
      aspectRatio,
      n: 1,
    },
    fanOut: count,
    warnings: [],
    expectedAspect: sized.width / sized.height,
  }
}
