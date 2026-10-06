import { IMAGE_MODEL_PROFILES, publicImageModel } from '../../shared/image-models.js'
import type { ImageOperation } from '../../shared/image-generation.js'
import { dragonCodeProvider } from './dragoncode/index.js'
import { createMockImageProvider } from './mock.js'
import { qwenImageProvider } from './qwen-image/index.js'
import type { ImageProvider } from './types.js'

const providers: ImageProvider[] = [dragonCodeProvider, qwenImageProvider, createMockImageProvider()]

export function imageProviderById(id: string) {
  return providers.find(provider => provider.id === id)
}

export function configuredImageModels(
  operation?: ImageOperation,
  env: NodeJS.ProcessEnv = process.env,
) {
  return IMAGE_MODEL_PROFILES.filter(profile => {
    if (operation && !profile.operations.includes(operation)) return false
    const provider = imageProviderById(profile.provider)
    if (!provider) return false
    // 千问文生图的 profile.enabled 保持 false，避免积分说明和本地 Mock 在开关关闭时露出模型。
    // 实际是否列出由 QWEN_IMAGE_ENABLED 与百炼 Key 决定。
    if (profile.provider === 'bailian') {
      return provider.configured(env) && provider.acceptsModel?.(profile.model, env) === true
    }
    if (!profile.enabled) return false
    return provider.configured(env)
  })
}

export function publicConfiguredImageModels(operation?: ImageOperation, env?: NodeJS.ProcessEnv) {
  return configuredImageModels(operation, env).map(publicImageModel)
}

export function imageModelsAvailable(operation: ImageOperation, env?: NodeJS.ProcessEnv) {
  return configuredImageModels(operation, env).length > 0
}
