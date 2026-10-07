import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_AI_GATEWAY_BASE_URL,
  aiGatewayImageAvailable,
  aiGatewayImageEnabled,
  aiGatewayImageSettings,
} from './config.js'

const KEYS = [
  'AI_GATEWAY_API_KEY',
  'AI_GATEWAY_IMAGE_ENABLED',
  'AI_GATEWAY_BASE_URL',
  'AI_GATEWAY_IMAGE_REQUEST_TIMEOUT_MS',
  'AI_GATEWAY_IMAGE_MAX_PARALLEL',
  'VERCEL_OIDC_TOKEN',
  'VERCEL',
] as const
const previous = Object.fromEntries(KEYS.map(key => [key, process.env[key]]))

afterEach(() => {
  for (const key of KEYS) {
    const value = previous[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('AI Gateway 图片配置', () => {
  it('缺少凭证或开关不是精确的 true 时不可用', () => {
    delete process.env.AI_GATEWAY_API_KEY
    delete process.env.AI_GATEWAY_IMAGE_ENABLED
    delete process.env.VERCEL_OIDC_TOKEN
    delete process.env.VERCEL
    expect(aiGatewayImageEnabled()).toBe(false)
    expect(aiGatewayImageSettings()).toBeNull()
    expect(aiGatewayImageAvailable()).toBe(false)

    process.env.AI_GATEWAY_API_KEY = 'gw-test-key'
    process.env.AI_GATEWAY_IMAGE_ENABLED = 'false'
    expect(aiGatewayImageAvailable()).toBe(false)
    process.env.AI_GATEWAY_IMAGE_ENABLED = 'TRUE'
    expect(aiGatewayImageAvailable()).toBe(false)
    delete process.env.AI_GATEWAY_API_KEY
    process.env.AI_GATEWAY_IMAGE_ENABLED = 'true'
    expect(aiGatewayImageAvailable()).toBe(false)
  })

  it('开关和 API Key 都就绪后才可用，并忽略非 https 地址', () => {
    process.env.AI_GATEWAY_API_KEY = '  gw-test-key  '
    process.env.AI_GATEWAY_IMAGE_ENABLED = 'true'
    process.env.AI_GATEWAY_BASE_URL = 'http://evil.example/v1'
    process.env.AI_GATEWAY_IMAGE_REQUEST_TIMEOUT_MS = '10'
    process.env.AI_GATEWAY_IMAGE_MAX_PARALLEL = '9'
    const settings = aiGatewayImageSettings()
    expect(aiGatewayImageAvailable()).toBe(true)
    expect(settings).toMatchObject({
      apiKey: 'gw-test-key',
      baseUrl: DEFAULT_AI_GATEWAY_BASE_URL,
      model: 'google/gemini-nano-banana-2.1',
      requestTimeoutMs: 5_000,
      maxParallel: 4,
    })
    process.env.AI_GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1/'
    expect(aiGatewayImageSettings()?.baseUrl).toBe('https://ai-gateway.vercel.sh/v1')
  })

  it('没有 API Key 时，OIDC 令牌或 Vercel 运行时可以退回', () => {
    delete process.env.AI_GATEWAY_API_KEY
    process.env.AI_GATEWAY_IMAGE_ENABLED = 'true'
    process.env.VERCEL_OIDC_TOKEN = 'oidc-from-env'
    expect(aiGatewayImageSettings()).toMatchObject({
      baseUrl: DEFAULT_AI_GATEWAY_BASE_URL,
      model: 'google/gemini-nano-banana-2.1',
    })
    expect(aiGatewayImageSettings()?.apiKey).toBeUndefined()

    delete process.env.VERCEL_OIDC_TOKEN
    process.env.VERCEL = '1'
    expect(aiGatewayImageAvailable()).toBe(true)
    expect(aiGatewayImageSettings()?.apiKey).toBeUndefined()
  })
})
