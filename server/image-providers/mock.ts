import type { NormalizedImageRequest } from '../../shared/image-generation.js'
import type { ImageProvider, ProviderCapabilities, ProviderContext, ProviderSubmitInput } from './types.js'
import { ProviderError } from './types.js'
import { randomUUID } from 'node:crypto'

export function mockImageAllowed(env: NodeJS.ProcessEnv = process.env) {
  return env.AIGC_IMAGE_MOCK_PROVIDER === 'true' && env.VERCEL_ENV !== 'production' && env.AIGC_RUNTIME_SCOPE !== 'production'
}

function guardMockProduction(ctx: ProviderContext) {
  if (process.env.VERCEL_ENV === 'production' || process.env.AIGC_RUNTIME_SCOPE === 'production' || ctx.execution?.scope === 'production') {
    const error = new ProviderError('INVALID_PARAMS','正式环境禁止模拟图片供应商',false,400)
    error.requestSent = false
    throw error
  }
}

const PNG_1X1 = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1,
  8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207,
  192, 240, 31, 0, 5, 0, 1, 255, 137, 153, 61, 29, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
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
      return mockImageAllowed(env)
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
      guardMockProduction(ctx)
      if (options?.submit) return options.submit(input, ctx)
      return { providerTaskId: `mock-${ctx.now()}-${input.ordinal ?? 0}-${randomUUID()}` }
    },
    async getStatus(providerTaskId: string, ctx: ProviderContext) {
      guardMockProduction(ctx)
      if (options?.getStatus) return options.getStatus(providerTaskId, ctx)
      const submittedAt = Number(/^mock-(\d+)-/.exec(providerTaskId)?.[1])
      const delay = Math.min(240_000,Math.max(0,Number(process.env.IMAGE_MOCK_DELAY_MS) || 0))
      if (submittedAt && ctx.now() < submittedAt + delay) return { state: 'processing',progress: 50 }
      return { state: 'succeeded', resultUrls: [`https://mock.local/${providerTaskId}.png`] }
    },
    async fetchResult(url: string, ctx: ProviderContext) {
      if (options?.fetchResult) return options.fetchResult(url, ctx)
      return { bytes: PNG_1X1, mimeType: 'image/png' }
    },
  }
}

export function requireMockConfigured(env: NodeJS.ProcessEnv = process.env) {
  if (!mockImageAllowed(env)) {
    throw new ProviderError('INVALID_KEY', '未启用模拟图片供应商', false, 503)
  }
}

export const MOCK_PNG_1X1 = PNG_1X1
