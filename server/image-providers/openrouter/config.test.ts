import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_OPENROUTER_BASE_URL,
  openRouterImageAvailable,
  openRouterImageEnabled,
  openRouterImageSettings,
} from './config.js'

const KEYS = [
  'OPENROUTER_API_KEY',
  'OPENROUTER_IMAGE_ENABLED',
  'OPENROUTER_BASE_URL',
  'OPENROUTER_IMAGE_REQUEST_TIMEOUT_MS',
  'OPENROUTER_IMAGE_MAX_PARALLEL',
] as const
const previous = Object.fromEntries(KEYS.map(key => [key, process.env[key]]))

afterEach(() => {
  for (const key of KEYS) {
    const value = previous[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('OpenRouter 图片配置', () => {
  it('缺少 Key 或开关不是精确的 true 时不可用', () => {
    delete process.env.OPENROUTER_API_KEY
    delete process.env.OPENROUTER_IMAGE_ENABLED
    expect(openRouterImageEnabled()).toBe(false)
    expect(openRouterImageSettings()).toBeNull()
    expect(openRouterImageAvailable()).toBe(false)

    process.env.OPENROUTER_API_KEY = 'sk-openrouter'
    process.env.OPENROUTER_IMAGE_ENABLED = 'false'
    expect(openRouterImageSettings()?.model).toBe('google/gemini-nano-banana-2.1')
    expect(openRouterImageAvailable()).toBe(false)

    process.env.OPENROUTER_IMAGE_ENABLED = 'TRUE'
    expect(openRouterImageAvailable()).toBe(false)
    delete process.env.OPENROUTER_API_KEY
    process.env.OPENROUTER_IMAGE_ENABLED = 'true'
    expect(openRouterImageAvailable()).toBe(false)
  })

  it('开关和 Key 都就绪后才可用，并忽略非 https 地址', () => {
    process.env.OPENROUTER_API_KEY = '  sk-openrouter  '
    process.env.OPENROUTER_IMAGE_ENABLED = 'true'
    process.env.OPENROUTER_BASE_URL = 'http://evil.example/api/v1'
    process.env.OPENROUTER_IMAGE_REQUEST_TIMEOUT_MS = '10'
    process.env.OPENROUTER_IMAGE_MAX_PARALLEL = '9'
    const settings = openRouterImageSettings()
    expect(openRouterImageAvailable()).toBe(true)
    expect(settings).toMatchObject({
      apiKey: 'sk-openrouter',
      baseUrl: DEFAULT_OPENROUTER_BASE_URL,
      model: 'google/gemini-nano-banana-2.1',
      requestTimeoutMs: 5_000,
      maxParallel: 4,
    })
    process.env.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1/'
    expect(openRouterImageSettings()?.baseUrl).toBe('https://openrouter.ai/api/v1')
  })
})
