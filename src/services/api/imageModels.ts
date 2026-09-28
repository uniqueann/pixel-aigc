import { apiClient } from './client'
import type { PublicImageModel } from '@shared/image-models'
import type { ImageOperation } from '@shared/image-generation'

export type { PublicImageModel }

export function listImageModels(operation?: ImageOperation) {
  return apiClient.get<unknown, { items: PublicImageModel[] }>('/image-models', {
    params: operation ? { operation } : undefined,
  }).then(result => result.items ?? [])
}
