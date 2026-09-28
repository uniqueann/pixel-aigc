import type { NormalizedImageRequest } from '../../shared/image-generation.js'
import type { ImageProvider, ProviderCapabilities, ProviderContext, ProviderSubmitInput } from './types.js'
import { ProviderError } from './types.js'

const PNG_1X1 = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1,
  8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207,
  192, 240, 31, 0, 5, 0, 1, 255, 23, 82, 97, 93, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
])

export function createMockImageProvider(options?: {
  submit?: ImageProvider['submit']
  getStatus?: ImageProvider['getStatus']
  fetchResult?: ImageProvider['fetchResult']
}): ImageProvider {
  return {
    id: 'mock',
    capabilities(): ProviderCapabilities {
      return {
        operations: ['image_edit', 'text_to_image', 'variation'],
        supportsMask: false,
        maxRefImages: 4,
        maxN: 1,
        sizeMode: 'ratio',
        ratios: ['1:1', '3:2', '2:3'],
        resolutions: ['1k', '2k', '4k'],
        acceptsInput: ['url', 'data'],
        execution: 'async',
      }
    },
    configured(env: NodeJS.ProcessEnv = process.env) {
      return env.AIGC_IMAGE_MOCK_PROVIDER === 'true'
    },
    mapRequest(req: NormalizedImageRequest, model: string) {
      const count = Math.min(4, Math.max(1, Math.round(req.count || 1)))
      return {
        providerParams: { model, size: '1:1', resolution: req.target.resolution ?? '2k', n: 1 },
        fanOut: count,
        warnings: [],
        expectedAspect: 1,
      }
    },
    async submit(input: ProviderSubmitInput, ctx: ProviderContext) {
      if (options?.submit) return options.submit(input, ctx)
      return { providerTaskId: `mock-${ctx.now()}` }
    },
    async getStatus(providerTaskId: string, ctx: ProviderContext) {
      if (options?.getStatus) return options.getStatus(providerTaskId, ctx)
      return { state: 'succeeded', resultUrls: [`https://mock.local/${providerTaskId}.png`] }
    },
    async fetchResult(url: string, ctx: ProviderContext) {
      if (options?.fetchResult) return options.fetchResult(url, ctx)
      return { bytes: PNG_1X1, mimeType: 'image/png' }
    },
  }
}

export function requireMockConfigured(env: NodeJS.ProcessEnv = process.env) {
  if (env.AIGC_IMAGE_MOCK_PROVIDER !== 'true') {
    throw new ProviderError('INVALID_KEY', '未启用模拟图片供应商', false, 503)
  }
}

export const MOCK_PNG_1X1 = PNG_1X1
