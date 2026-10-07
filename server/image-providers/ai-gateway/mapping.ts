import type { NormalizedImageRequest } from '../../../shared/image-generation.js'
import { OPENROUTER_NANO_BANANA_MODEL } from '../../../shared/image-models.js'
import {
  OPENROUTER_IMAGE_CAPABILITIES,
  OPENROUTER_IMAGE_RATIOS,
  mapOpenRouterImageRequest,
  type OpenRouterImageSize,
} from '../openrouter/mapping.js'

export const AI_GATEWAY_IMAGE_RATIOS = OPENROUTER_IMAGE_RATIOS
export const AI_GATEWAY_IMAGE_CAPABILITIES = OPENROUTER_IMAGE_CAPABILITIES

export interface AiGatewayImageConfig {
  aspectRatio: string
  imageSize: OpenRouterImageSize
}

/**
 * Chat Completions 请求。宽高比和分辨率走 providerOptions，不走 OpenRouter 的 image_config。
 * google 与 vertex 写同一份 imageConfig：1:1 + 1K 的实测返回 1024x1024。
 * 见 https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/image-generation
 * 以及 https://vercel.com/docs/ai-gateway/models-and-providers/provider-options
 * AI SDK：providerOptions.google.imageConfig / providerOptions.vertex.imageConfig
 * https://ai-sdk.dev/providers/ai-sdk-providers/google
 * https://ai-sdk.dev/providers/ai-sdk-providers/google-vertex
 */
export interface AiGatewayChatBody {
  model: string
  messages: Array<{
    role: 'user'
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    >
  }>
  modalities: ['text', 'image']
  stream: false
  providerOptions: {
    google: { imageConfig: AiGatewayImageConfig }
    vertex: { imageConfig: AiGatewayImageConfig }
  }
}

export function buildAiGatewayChatBody(input: {
  model: string
  prompt: string
  images: Array<{ url: string }>
  aspectRatio: string
  imageSize: OpenRouterImageSize
}): AiGatewayChatBody {
  const imageConfig = { aspectRatio: input.aspectRatio, imageSize: input.imageSize }
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
    modalities: ['text', 'image'],
    stream: false,
    providerOptions: {
      google: { imageConfig },
      vertex: { imageConfig: { ...imageConfig } },
    },
  }
}

export function mapAiGatewayImageRequest(req: NormalizedImageRequest, model: string = OPENROUTER_NANO_BANANA_MODEL) {
  return mapOpenRouterImageRequest(req, model)
}
