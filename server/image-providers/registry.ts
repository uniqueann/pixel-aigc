import { IMAGE_MODEL_PROFILES, NANO_BANANA_PROFILE_ID, publicImageModel } from '../../shared/image-models.js'
import type { ImageOperation } from '../../shared/image-generation.js'
import { aiGatewayGptImageAvailable, aiGatewayImageAvailable, aiGatewayImageProvider } from './ai-gateway/index.js'
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

const DRAGONCODE_HINT_WITHOUT_GPT_IMAGE = '支持 4K'

export function configuredImageModels(
  operation?: ImageOperation,
  env: NodeJS.ProcessEnv = process.env,
) {
  const gptImageListed = aiGatewayGptImageAvailable(env)
  return IMAGE_MODEL_PROFILES.flatMap(profile => {
    if (operation && !profile.operations.includes(operation)) return []
    let active = profile.id === NANO_BANANA_PROFILE_ID && aiGatewayImageAvailable(env)
      ? { ...profile, provider: 'ai-gateway' as const }
      : profile
    // 目录里的「可选 GPT Image 2.6」只在该模型真的出现在列表里时下发。
    if (active.id === 'dragoncode:gpt-image-2' && !gptImageListed) {
      active = {
        ...active,
        hints: {
          text_to_image: DRAGONCODE_HINT_WITHOUT_GPT_IMAGE,
          image_input: DRAGONCODE_HINT_WITHOUT_GPT_IMAGE,
          single_image: DRAGONCODE_HINT_WITHOUT_GPT_IMAGE,
        },
      }
    }
    const provider = imageProviderById(active.provider)
    if (!provider) return []
    if (active.provider === 'mock') return provider.configured(env) ? [active] : []
    // 千问、Nano Banana 和 GPT Image 2.6 的 profile.enabled 保持 false，避免积分说明和本地 Mock 在开关关闭时露出模型。
    // 千问由 QWEN_IMAGE_ENABLED 与百炼 Key 决定。
    // Nano Banana 在 AI_GATEWAY_IMAGE_ENABLED 和凭证就绪时改走 ai-gateway；否则仍看 OpenRouter 开关和 Key。
    // GPT Image 2.6 只看 AI_GATEWAY_GPT_IMAGE_ENABLED 和同一套 Gateway 凭证，不跟随 Nano Banana 的开关。
    if (active.provider === 'bailian' || active.provider === 'openrouter' || active.provider === 'ai-gateway') {
      return provider.configured(env) && provider.acceptsModel?.(active.model, env) === true ? [active] : []
    }
    if (!active.enabled || !provider.configured(env)) return []
    return [active]
  })
}

export function publicConfiguredImageModels(operation?: ImageOperation, env?: NodeJS.ProcessEnv) {
  return configuredImageModels(operation, env).map(publicImageModel)
}

export function imageModelsAvailable(operation: ImageOperation, env?: NodeJS.ProcessEnv) {
  return configuredImageModels(operation, env).length > 0
}
