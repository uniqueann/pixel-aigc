import {
  GPT_IMAGE_26_PROFILE_ID,
  GPT_IMAGE_26_SPEED_HINT,
  IMAGE_MODEL_PROFILES,
  NANO_BANANA_PROFILE_ID,
  publicImageModel,
  type ImageModelProfile,
} from '../../shared/image-models.js'
import type { ImageOperation } from '../../shared/image-generation.js'
import { aiGatewayImageAvailable, aiGatewayImageProvider } from './ai-gateway/index.js'
import { dragonCodeProvider } from './dragoncode/index.js'
import { createMockImageProvider } from './mock.js'
import { openRouterImageProvider } from './openrouter/index.js'
import { qwenImageProvider } from './qwen-image/index.js'
import type { ImageProvider } from './types.js'

const providers: ImageProvider[] = [
  dragonCodeProvider,
  qwenImageProvider,
  aiGatewayImageProvider,
  openRouterImageProvider,
  createMockImageProvider(),
]

export function imageProviderById(id: string) {
  return providers.find(provider => provider.id === id)
}

function withGptImageSpeedHint(profiles: ImageModelProfile[]) {
  if (!profiles.some(profile => profile.id === GPT_IMAGE_26_PROFILE_ID)) return profiles
  return profiles.map(profile => profile.id === 'dragoncode:gpt-image-2'
    ? {
        ...profile,
        hints: {
          text_to_image: GPT_IMAGE_26_SPEED_HINT,
          image_input: GPT_IMAGE_26_SPEED_HINT,
          single_image: GPT_IMAGE_26_SPEED_HINT,
        },
      }
    : profile)
}

export function configuredImageModels(
  operation?: ImageOperation,
  env: NodeJS.ProcessEnv = process.env,
) {
  return withGptImageSpeedHint(IMAGE_MODEL_PROFILES.flatMap(profile => {
    if (operation && !profile.operations.includes(operation)) return []
    const active = profile.id === NANO_BANANA_PROFILE_ID && aiGatewayImageAvailable(env)
      ? { ...profile, provider: 'ai-gateway' as const }
      : profile
    const provider = imageProviderById(active.provider)
    if (!provider) return []
    if (active.provider === 'mock') return provider.configured(env) ? [active] : []
    // 千问、Nano Banana 和 GPT Image 2.6 的 profile.enabled 保持 false，避免积分说明和本地 Mock 在开关关闭时露出模型。
    // 千问由 QWEN_IMAGE_ENABLED 与百炼 Key 决定。
    // Nano Banana 在 AI_GATEWAY_IMAGE_ENABLED 和凭证就绪时改走 ai-gateway；否则仍看 OpenRouter 开关和 Key。
    // GPT Image 2.6 只看 AI_GATEWAY_GPT_IMAGE_ENABLED，不跟随 Nano Banana 的开关。
    if (active.provider === 'bailian' || active.provider === 'openrouter' || active.provider === 'ai-gateway') {
      return provider.configured(env) && provider.acceptsModel?.(active.model, env) === true ? [active] : []
    }
    if (!active.enabled || !provider.configured(env)) return []
    return [active]
  }))
}

export function publicConfiguredImageModels(operation?: ImageOperation, env?: NodeJS.ProcessEnv) {
  return configuredImageModels(operation, env).map(publicImageModel)
}

export function imageModelsAvailable(operation: ImageOperation, env?: NodeJS.ProcessEnv) {
  return configuredImageModels(operation, env).length > 0
}
