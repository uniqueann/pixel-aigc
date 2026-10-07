import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configuredImageModels, imageModelsAvailable, publicConfiguredImageModels } from './registry.js'

const KEYS = [
  'DRAGONCODE_API_KEY', 'DASHSCOPE_API_KEY', 'QWEN_IMAGE_ENABLED', 'QWEN_IMAGE_API_KEY', 'QWEN_IMAGE_MODELS',
  'OPENROUTER_API_KEY', 'OPENROUTER_IMAGE_ENABLED', 'OPENROUTER_BASE_URL',
  'AI_GATEWAY_API_KEY', 'AI_GATEWAY_IMAGE_ENABLED', 'VERCEL', 'VERCEL_OIDC_TOKEN',
] as const
const previous = Object.fromEntries(KEYS.map(key => [key, process.env[key]]))

beforeEach(() => {
  delete process.env.OPENROUTER_API_KEY
  delete process.env.OPENROUTER_IMAGE_ENABLED
  delete process.env.OPENROUTER_BASE_URL
  delete process.env.AI_GATEWAY_API_KEY
  delete process.env.AI_GATEWAY_IMAGE_ENABLED
  delete process.env.VERCEL_OIDC_TOKEN
  delete process.env.VERCEL
})

afterEach(() => {
  for (const key of KEYS) {
    const value = previous[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('图片模型目录', () => {
  it('千问开关关闭时，即使有百炼 Key 也只列出 GPT Image 2', () => {
    process.env.DRAGONCODE_API_KEY = 'sk-dragon'
    process.env.DASHSCOPE_API_KEY = 'sk-dash'
    delete process.env.QWEN_IMAGE_ENABLED
    const models = publicConfiguredImageModels('text_to_image')
    expect(models.map(model => model.id)).toEqual(['dragoncode:gpt-image-2'])
    expect(JSON.stringify(models)).not.toContain('vendorCost')
    expect(JSON.stringify(models)).not.toContain('0.18')
    expect(imageModelsAvailable('text_to_image')).toBe(true)
    expect(imageModelsAvailable('image_edit')).toBe(true)
  })

  it('只有百炼 Key 且开关关闭时，文生图能力保持关闭', () => {
    delete process.env.DRAGONCODE_API_KEY
    process.env.DASHSCOPE_API_KEY = 'sk-dash'
    process.env.QWEN_IMAGE_ENABLED = 'false'
    expect(imageModelsAvailable('text_to_image')).toBe(false)
    expect(publicConfiguredImageModels('text_to_image')).toEqual([])
  })

  it('开关打开后列出两个千问模型，公开字段不含供应商成本', () => {
    delete process.env.DRAGONCODE_API_KEY
    process.env.DASHSCOPE_API_KEY = 'sk-dash'
    process.env.QWEN_IMAGE_ENABLED = 'true'
    const models = publicConfiguredImageModels('text_to_image')
    expect(models.map(model => model.id)).toEqual(['bailian:qwen-image-3.0', 'bailian:qwen-image-3.0-pro'])
    expect(models.map(model => model.pricing.creditsPerImage)).toEqual([
      { '1k': 3, '2k': 3 },
      { '1k': 4, '2k': 8 },
    ])
    expect(JSON.stringify(models)).not.toContain('vendorCost')
    expect(JSON.stringify(models)).not.toContain('vendorCurrency')
    expect(imageModelsAvailable('image_edit')).toBe(false)
    expect(configuredImageModels('text_to_image').every(model => model.provider === 'bailian')).toBe(true)
  })

  it('白名单可以只打开标准版，默认文生图模型仍是列表中的第一个 GPT', () => {
    process.env.DRAGONCODE_API_KEY = 'sk-dragon'
    process.env.DASHSCOPE_API_KEY = 'sk-dash'
    process.env.QWEN_IMAGE_ENABLED = 'true'
    process.env.QWEN_IMAGE_MODELS = 'qwen-image-3.0'
    const models = publicConfiguredImageModels('text_to_image')
    expect(models.map(model => model.id)).toEqual(['dragoncode:gpt-image-2', 'bailian:qwen-image-3.0'])
    expect(models[0].defaultFor).toEqual(['image_edit', 'variation'])
  })

  it('没有 OpenRouter Key 或开关关闭时不列出 Nano Banana，其他模型不受影响', () => {
    process.env.DRAGONCODE_API_KEY = 'sk-dragon'
    process.env.OPENROUTER_IMAGE_ENABLED = 'true'
    delete process.env.OPENROUTER_API_KEY
    expect(publicConfiguredImageModels('text_to_image').map(model => model.id)).toEqual(['dragoncode:gpt-image-2'])
    process.env.OPENROUTER_API_KEY = 'sk-openrouter'
    process.env.OPENROUTER_IMAGE_ENABLED = 'false'
    expect(publicConfiguredImageModels('text_to_image').map(model => model.id)).toEqual(['dragoncode:gpt-image-2'])
    expect(publicConfiguredImageModels('image_edit').map(model => model.id)).toEqual(['dragoncode:gpt-image-2'])
    expect(imageModelsAvailable('variation')).toBe(true)
  })

  it('开关和 Key 都就绪后列出 Nano Banana，报价为 4/6/14 且不含供应商成本', () => {
    delete process.env.DRAGONCODE_API_KEY
    process.env.OPENROUTER_API_KEY = 'sk-openrouter'
    process.env.OPENROUTER_IMAGE_ENABLED = 'true'
    const models = publicConfiguredImageModels('text_to_image')
    expect(models.map(model => model.id)).toEqual(['openrouter:gemini-nano-banana-2.1'])
    expect(models[0].pricing.creditsPerImage).toEqual({ '1k': 4, '2k': 6, '4k': 14 })
    expect(models[0].label).toBe('Google Nano Banana 2.1')
    expect(JSON.stringify(models)).not.toContain('vendorCost')
    expect(JSON.stringify(models)).not.toContain('0.039359')
    expect(publicConfiguredImageModels('image_edit').map(model => model.id)).toEqual(['openrouter:gemini-nano-banana-2.1'])
    expect(publicConfiguredImageModels('variation').map(model => model.id)).toEqual(['openrouter:gemini-nano-banana-2.1'])
    expect(configuredImageModels('text_to_image')[0].provider).toBe('openrouter')
  })

  it('AI Gateway 开关打开后 Nano Banana 改走 Gateway，同时开着 OpenRouter 也不再打它', () => {
    delete process.env.DRAGONCODE_API_KEY
    process.env.AI_GATEWAY_API_KEY = 'gw-test-key'
    process.env.AI_GATEWAY_IMAGE_ENABLED = 'true'
    process.env.OPENROUTER_API_KEY = 'sk-openrouter'
    process.env.OPENROUTER_IMAGE_ENABLED = 'true'
    const models = publicConfiguredImageModels('text_to_image')
    expect(models.map(model => model.id)).toEqual(['openrouter:gemini-nano-banana-2.1'])
    expect(models[0].pricing.creditsPerImage).toEqual({ '1k': 4, '2k': 6, '4k': 14 })
    expect(configuredImageModels('text_to_image')[0].provider).toBe('ai-gateway')
    expect(JSON.stringify(models)).not.toContain('vendorCost')
    delete process.env.AI_GATEWAY_API_KEY
    delete process.env.VERCEL
    delete process.env.VERCEL_OIDC_TOKEN
    expect(configuredImageModels('text_to_image')[0].provider).toBe('openrouter')
  })
})
