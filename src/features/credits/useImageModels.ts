import { useQuery } from '@tanstack/react-query'
import { IMAGE_MODEL_PROFILES, publicImageModel } from '@shared/image-models'
import type { ImageOperation } from '@shared/image-generation'
import { cloudEnabled } from '@/cloud/client'
import { listImageModels } from '@/services/api/imageModels'
import { useUserStore } from '@/store/useUserStore'
import { billingRuntimeScope } from './useBillingCatalog'

const mock = import.meta.env.VITE_GENERATION_MODE === 'mock' && !cloudEnabled
const mockModels = IMAGE_MODEL_PROFILES.filter(profile => profile.enabled).map(publicImageModel)

export function useImageModels(operation: ImageOperation) {
  const owner = useUserStore(state => state.userId)
  const query = useQuery({
    queryKey: ['image-models', billingRuntimeScope, owner, operation],
    queryFn: async ({ signal }) => {
      const models = await listImageModels(operation, signal)
      signal.throwIfAborted()
      if (useUserStore.getState().userId !== owner) throw new DOMException('账号已切换', 'AbortError')
      return models
    },
    enabled: !mock,
    staleTime: 60_000,
  })
  return { ...query, models: mock ? mockModels.filter(model => model.operations.includes(operation)) : query.data ?? [], loading: !mock && query.isPending }
}
