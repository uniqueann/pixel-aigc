import type { VideoModelProfile } from '@shared/video-models'
import { apiClient } from './client'

export async function listVideoModels(signal?: AbortSignal) {
  const result = await apiClient.get<unknown, { items: VideoModelProfile[] }>('/video-models', { signal })
  return result.items
}
