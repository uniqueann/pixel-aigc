import type { ImageResolution, NormalizedImageRequest } from '../../../shared/image-generation.js'
import {
  OPENROUTER_NANO_BANANA_MODEL,
  nearestRatio,
  ratioValue,
} from '../../../shared/image-models.js'
import type { MappedImageRequest } from '../types.js'
import { OPENROUTER_MAX_REFERENCE_IMAGES } from './config.js'

/**
 * Google Nano Banana 2.1 支持的比例。
 * 见 https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/nano-banana-2-1
 * 以及 OpenRouter image_config：https://openrouter.ai/docs/guides/overview/multimodal/image-generation
 */
export const OPENROUTER_IMAGE_RATIOS = [
  '1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4',
  '1:4', '4:1', '1:8', '8:1', '9:16', '16:9', '21:9', '9:21',
] as const

export type OpenRouterImageRatio = typeof OPENROUTER_IMAGE_RATIOS[number]
export type OpenRouterImageSize = '1K' | '2K' | '4K'

export const OPENROUTER_IMAGE_CAPABILITIES = {
  operations: ['text_to_image', 'image_edit', 'variation'] as const,
  supportsMask: false,
  maxRefImages: OPENROUTER_MAX_REFERENCE_IMAGES,
  maxN: 1,
  sizeMode: 'ratio' as const,
  ratios: [...OPENROUTER_IMAGE_RATIOS],
  resolutions: ['1k', '2k', '4k'] as const,
  acceptsInput: ['url', 'data'] as Array<'url' | 'data'>,
  execution: 'async' as const,
}

export function openRouterImageSize(resolution: ImageResolution | undefined): OpenRouterImageSize {
  if (resolution === '1k') return '1K'
  if (resolution === '4k') return '4K'
  return '2K'
}

function isOpenRouterRatio(value: string): value is OpenRouterImageRatio {
  return (OPENROUTER_IMAGE_RATIOS as readonly string[]).includes(value)
}

function requestPixels(req: NormalizedImageRequest) {
  const primary = req.images[0]
  if (primary?.width && primary.height) return { width: primary.width, height: primary.height }
  if (req.target.size?.width && req.target.size.height) return req.target.size
  if (req.target.aspectRatio && isOpenRouterRatio(req.target.aspectRatio)) {
    const [width, height] = req.target.aspectRatio.split(':').map(Number)
    return { width, height }
  }
  return { width: 1, height: 1 }
}

export interface OpenRouterChatBody {
  model: string
  messages: Array<{
    role: 'user'
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    >
  }>
  modalities: ['image', 'text']
  image_config: { aspect_ratio: string; image_size: OpenRouterImageSize }
}

/** Chat completions 请求。不带 plugins、tools 或 web search。参考图只放在 content 里。 */
export function buildOpenRouterChatBody(input: {
  model: string
  prompt: string
  images: Array<{ url: string }>
  aspectRatio: string
  imageSize: OpenRouterImageSize
}): OpenRouterChatBody {
  return {
    model: input.model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: input.prompt },
        ...input.images.map(image => ({
          type: 'image_url' as const,
          image_url: { url: image.url },
        })),
      ],
    }],
    modalities: ['image', 'text'],
    image_config: {
      aspect_ratio: input.aspectRatio,
      image_size: input.imageSize,
    },
  }
}

export function mapOpenRouterImageRequest(req: NormalizedImageRequest, model: string = OPENROUTER_NANO_BANANA_MODEL): MappedImageRequest {
  const count = Math.min(4, Math.max(1, Math.round(req.count || 1)))
  const pixels = requestPixels(req)
  const aspectRatio = req.target.aspectRatio && isOpenRouterRatio(req.target.aspectRatio)
    ? req.target.aspectRatio
    : nearestRatio(pixels.width, pixels.height, OPENROUTER_IMAGE_RATIOS)
  const resolution = req.target.resolution === '1k' || req.target.resolution === '4k' ? req.target.resolution : '2k'
  const imageSize = openRouterImageSize(resolution)
  return {
    providerParams: {
      model,
      aspectRatio,
      imageSize,
      resolution,
      n: 1,
    },
    fanOut: count,
    warnings: [],
    expectedAspect: ratioValue(aspectRatio),
  }
}
