import { IMAGE_MODEL_PROFILES, publicImageModel } from '../../shared/image-models.js'
import type { ImageOperation } from '../../shared/image-generation.js'
import { dragonCodeProvider } from './dragoncode/index.js'
import { createMockImageProvider } from './mock.js'
import type { ImageProvider } from './types.js'

const providers: ImageProvider[] = [dragonCodeProvider, createMockImageProvider()]

export function imageProviderById(id: string) {
  return providers.find(provider => provider.id === id)
}

export function configuredImageModels(
  operation?: ImageOperation,
  env: NodeJS.ProcessEnv = process.env,
) {
  return IMAGE_MODEL_PROFILES.filter(profile => {
    if (!profile.enabled) return false
    if (operation && !profile.operations.includes(operation)) return false
    return imageProviderById(profile.provider)?.configured(env) === true
  })
}

export function publicConfiguredImageModels(operation?: ImageOperation, env?: NodeJS.ProcessEnv) {
  return configuredImageModels(operation, env).map(publicImageModel)
}

export function imageModelsAvailable(operation: ImageOperation, env?: NodeJS.ProcessEnv) {
  return configuredImageModels(operation, env).length > 0
}
