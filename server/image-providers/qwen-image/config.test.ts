import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_QWEN_IMAGE_BASE_URL,
  qwenForcedThrottle,
  qwenImageAvailable,
  qwenImageConcurrencyLimits,
  qwenImageEnabled,
  qwenImageSettings,
  qwenThrottleBackoffMs,
  resolveQwenEnableThinking,
} from './config.js'

const KEYS = [
  'QWEN_IMAGE_ENABLED',
  'QWEN_IMAGE_API_KEY',
  'QWEN_IMAGE_BASE_URL',
  'QWEN_IMAGE_MODELS',
  'QWEN_IMAGE_PROMPT_EXTEND',
  'QWEN_IMAGE_THINKING',
  'QWEN_IMAGE_TASK_TIMEOUT_MS',
  'QWEN_IMAGE_POLL_INTERVAL_MS',
  'QWEN_IMAGE_INITIAL_POLL_DELAY_MS',
  'QWEN_IMAGE_MAX_PARALLEL',
  'QWEN_IMAGE_REQUEST_TIMEOUT_MS',
  'QWEN_IMAGE_REQUEST_RETRY_COUNT',
  'DASHSCOPE_API_KEY',
  'DASHSCOPE_BASE_URL',
] as const

const previous = Object.fromEntries(KEYS.map(key => [key, process.env[key]]))

afterEach(() => {
  for (const key of KEYS) {
    const value = previous[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('qwen image 配置', () => {
  it('默认关闭，只配百炼 Key 也不会对外可用', () => {
    delete process.env.QWEN_IMAGE_ENABLED
    process.env.DASHSCOPE_API_KEY = 'sk-dash'
    expect(qwenImageEnabled()).toBe(false)
    expect(qwenImageAvailable()).toBe(false)
    expect(qwenImageSettings()).toMatchObject({ apiKey: 'sk-dash', baseUrl: DEFAULT_QWEN_IMAGE_BASE_URL })
  })

  it('开关打开后回退到百炼 Key 和域名，专用变量优先', () => {
    process.env.QWEN_IMAGE_ENABLED = 'true'
    process.env.DASHSCOPE_API_KEY = 'sk-dash'
    process.env.DASHSCOPE_BASE_URL = 'https://ws.cn-beijing.maas.aliyuncs.com/api/v1/'
    process.env.QWEN_IMAGE_API_KEY = 'sk-qwen'
    process.env.QWEN_IMAGE_BASE_URL = 'https://other.cn-beijing.maas.aliyuncs.com/'
    expect(qwenImageAvailable()).toBe(true)
    expect(qwenImageSettings()).toMatchObject({
      apiKey: 'sk-qwen',
      baseUrl: 'https://other.cn-beijing.maas.aliyuncs.com',
      models: ['qwen-image-3.0', 'qwen-image-3.0-pro'],
      promptExtend: true,
      thinkingOverride: undefined,
      pollIntervalMs: 3_000,
      initialPollDelayMs: 3_000,
      connectTimeoutMs: 10_000,
      taskTimeoutMs: 300_000,
      maxParallel: 1,
    })
  })

  it('未设专用域名时使用 DASHSCOPE_BASE_URL 的 origin', () => {
    process.env.QWEN_IMAGE_ENABLED = 'true'
    process.env.DASHSCOPE_API_KEY = 'sk-dash'
    process.env.DASHSCOPE_BASE_URL = 'https://workspace.cn-beijing.maas.aliyuncs.com'
    expect(qwenImageSettings()?.baseUrl).toBe('https://workspace.cn-beijing.maas.aliyuncs.com')
  })

  it('模型白名单只保留两个官方 id，思考和扩写可关', () => {
    process.env.QWEN_IMAGE_ENABLED = 'true'
    process.env.DASHSCOPE_API_KEY = 'sk-dash'
    process.env.QWEN_IMAGE_MODELS = 'qwen-image-3.0, qwen-image-2.0, qwen-image-3.0'
    process.env.QWEN_IMAGE_PROMPT_EXTEND = 'false'
    process.env.QWEN_IMAGE_THINKING = '0'
    process.env.QWEN_IMAGE_TASK_TIMEOUT_MS = '120000'
    process.env.QWEN_IMAGE_MAX_PARALLEL = '9'
    const settings = qwenImageSettings()
    expect(settings?.models).toEqual(['qwen-image-3.0'])
    expect(settings).toMatchObject({ promptExtend: false, thinkingOverride: false, taskTimeoutMs: 120_000, maxParallel: 4 })
    process.env.QWEN_IMAGE_MODELS = 'not-a-model'
    expect(qwenImageAvailable()).toBe(false)
  })

  it('思考默认跟随请求，只有显式 true/false 才覆盖', () => {
    process.env.QWEN_IMAGE_ENABLED = 'true'
    process.env.DASHSCOPE_API_KEY = 'sk-dash'
    delete process.env.QWEN_IMAGE_THINKING
    expect(qwenImageSettings()?.thinkingOverride).toBeUndefined()
    expect(resolveQwenEnableThinking(qwenImageSettings(), false)).toBe(false)
    expect(resolveQwenEnableThinking(qwenImageSettings(), true)).toBe(true)
    process.env.QWEN_IMAGE_THINKING = 'yes'
    expect(qwenImageSettings()?.thinkingOverride).toBeUndefined()
    process.env.QWEN_IMAGE_THINKING = 'true'
    expect(resolveQwenEnableThinking(qwenImageSettings(), false)).toBe(true)
    process.env.QWEN_IMAGE_THINKING = 'false'
    expect(resolveQwenEnableThinking(qwenImageSettings(), true)).toBe(false)
    process.env.QWEN_IMAGE_PROMPT_EXTEND = 'false'
    process.env.QWEN_IMAGE_THINKING = 'true'
    expect(resolveQwenEnableThinking(qwenImageSettings(), true)).toBe(false)
  })

  it('并发上限有默认值，非法数字回退', () => {
    expect(qwenImageConcurrencyLimits({})).toEqual({ providerActive: 8, proActive: 4 })
    expect(qwenImageConcurrencyLimits({ QWEN_IMAGE_ACTIVE_LIMIT: '3', QWEN_IMAGE_PRO_ACTIVE_LIMIT: '2' })).toEqual({
      providerActive: 3, proActive: 2,
    })
    expect(qwenImageConcurrencyLimits({ QWEN_IMAGE_ACTIVE_LIMIT: '0', QWEN_IMAGE_PRO_ACTIVE_LIMIT: 'nope' })).toEqual({
      providerActive: 1, proActive: 4,
    })
  })

  it('限流退避按模型和次数增长，并带上抖动', () => {
    expect(qwenThrottleBackoffMs(1, 'qwen-image-3.0-pro', () => 0)).toBe(15_000)
    expect(qwenThrottleBackoffMs(1, 'bailian:qwen-image-3.0-pro', () => 1)).toBe(22_500)
    expect(qwenThrottleBackoffMs(2, 'qwen-image-3.0-pro', () => 0)).toBe(30_000)
    expect(qwenThrottleBackoffMs(4, 'qwen-image-3.0-pro', () => 0)).toBe(60_000)
    expect(qwenThrottleBackoffMs(1, 'qwen-image-3.0', () => 0)).toBe(8_000)
    expect(qwenThrottleBackoffMs(2, 'qwen-image-3.0', () => 0)).toBe(16_000)
    expect(qwenThrottleBackoffMs(3, 'qwen-image-3.0', () => 1)).toBe(48_000)
  })

  it('强制限流只在非生产环境打开', () => {
    expect(qwenForcedThrottle({})).toBeNull()
    expect(qwenForcedThrottle({ QWEN_IMAGE_FORCE_THROTTLE: 'true' })).toBeNull()
    expect(qwenForcedThrottle({
      QWEN_IMAGE_FORCE_THROTTLE: 'true', VERCEL_ENV: 'production', AIGC_RUNTIME_SCOPE: 'preview',
    })).toBeNull()
    expect(qwenForcedThrottle({
      QWEN_IMAGE_FORCE_THROTTLE: 'true', VERCEL_ENV: 'preview', AIGC_RUNTIME_SCOPE: 'production',
    })).toBeNull()
    expect(qwenForcedThrottle({
      QWEN_IMAGE_FORCE_THROTTLE: 'true', VERCEL_ENV: 'preview',
    })).toBe('rate')
    expect(qwenForcedThrottle({
      QWEN_IMAGE_FORCE_THROTTLE: 'quota', AIGC_RUNTIME_SCOPE: 'local',
    })).toBe('quota')
    expect(qwenForcedThrottle({
      QWEN_IMAGE_FORCE_THROTTLE: 'yes', VERCEL_ENV: 'preview',
    })).toBeNull()
  })
})
