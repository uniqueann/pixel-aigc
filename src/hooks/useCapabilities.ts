import { useQuery } from '@tanstack/react-query'
import { cloudEnabled } from '@/cloud/client'
import { loadCapabilityFlags, type CapabilityFlags } from '@/services/api/capabilities'
import { liveCapabilityReady } from '@/services/api/task'
import { Capability } from '@/types'

const mockGateway = import.meta.env.VITE_GENERATION_MODE === 'mock' && !cloudEnabled

/** 共享能力查询；undefined 表示尚未确认，只有 false 才表示确实不可用。 */
export function useCapabilities() {
  const query = useQuery({
    queryKey: ['capabilities'],
    queryFn: loadCapabilityFlags,
    enabled: !mockGateway,
    staleTime: 60000,
  })

  const configured = (key: keyof CapabilityFlags, fallback = false): boolean | undefined =>
    mockGateway || fallback || (query.data === undefined ? undefined : Boolean(query.data[key]))

  return {
    capabilities: {
      bgRemove: configured('bgRemove', liveCapabilityReady(Capability.BgRemove)),
      outpaint: configured('outpaint', liveCapabilityReady(Capability.Outpaint)),
      erase: configured('erase', liveCapabilityReady(Capability.Inpaint)),
      repaint: configured('repaint', liveCapabilityReady(Capability.Inpaint)),
      imageEdit: configured('imageEdit', liveCapabilityReady(Capability.ImageEdit)),
      variation: configured('variation'),
      textToImage: configured('textToImage'),
      textToVideo: configured('textToVideo'),
      imageToVideo: configured('imageToVideo'),
      smartSelect: configured('smartSelect'),
    },
    error: query.data === undefined ? query.error : null,
    refetch: query.refetch,
  }
}
