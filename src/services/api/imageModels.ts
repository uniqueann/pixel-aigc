import { apiClient } from './client'
import type { PublicImageModel } from '@shared/image-models'
import type { ImageOperation } from '@shared/image-generation'

export type { PublicImageModel }

export function listImageModels(operation?: ImageOperation, signal?: AbortSignal) {
  return apiClient.get<unknown, { items: PublicImageModel[] }>('/image-models', {
    params: operation ? { operation } : undefined,
    signal,
  }).then(result => result.items ?? [])
}
