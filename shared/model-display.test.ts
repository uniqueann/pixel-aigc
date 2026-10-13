import { describe, expect, it } from 'vitest'
import { modelDisplayName } from './model-display'

describe('modelDisplayName', () => {
  it('只返回目录展示名，旧 Nano Banana id 也不带渠道', () => {
    expect(modelDisplayName('gemini-nano-banana-2.1')).toBe('Nano Banana 2.1')
    expect(modelDisplayName('openrouter:gemini-nano-banana-2.1')).toBe('Nano Banana 2.1')
    expect(modelDisplayName('dragoncode:gpt-image-2')).toBe('GPT Image 2')
    expect(modelDisplayName('bailian:qwen-image-3.0')).toBe('Qwen Image 3.0')
    expect(modelDisplayName('bailian:qwen-image-3.0-pro')).toBe('Qwen Image 3.0 Pro')
    expect(modelDisplayName('seedance-2-0-fast')).toBe('Seedance 2.0 fast')
    expect(modelDisplayName('deepseek:deepseek-flash')).toBe('DeepSeek Flash')
    expect(modelDisplayName('ai-gateway:gemini-3.8-flash')).toBe('Gemini 3.8 Flash')
    expect(modelDisplayName('fixture')).toBe('历史模型')
    expect(modelDisplayName(null)).toBe('不适用')
    expect(modelDisplayName(undefined)).toBe('不适用')
    for (const id of ['gemini-nano-banana-2.1', 'openrouter:gemini-nano-banana-2.1', 'dragoncode:gpt-image-2', 'bailian:qwen-image-3.0']) {
      const label = modelDisplayName(id)
      expect(label).not.toBe(id)
      expect(label).not.toMatch(/openrouter|ai-gateway|dragoncode|bailian/i)
    }
  })
})
