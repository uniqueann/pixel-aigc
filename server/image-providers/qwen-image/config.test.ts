import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_QWEN_IMAGE_BASE_URL,
  qwenImageAvailable,
  qwenImageEnabled,
  qwenImageSettings,
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
      enableThinking: true,
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
    expect(settings).toMatchObject({ promptExtend: false, enableThinking: false, taskTimeoutMs: 120_000, maxParallel: 4 })
    process.env.QWEN_IMAGE_MODELS = 'not-a-model'
    expect(qwenImageAvailable()).toBe(false)
  })
})
