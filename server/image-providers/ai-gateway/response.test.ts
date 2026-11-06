import { describe, expect, it } from 'vitest'
import { MOCK_PNG_1X1 } from '../mock.js'
import {
  aiGatewayResultKey,
  aiGatewayResultUrl,
  decodeAiGatewayTask,
  encodeAiGatewayTask,
  gatewayImageTokenCost,
  parseAiGatewayImageResponse,
  parseAiGatewayImagesApiResponse,
} from './response.js'

const jpeg = Buffer.from(MOCK_PNG_1X1).toString('base64')

describe('AI Gateway 图片响应', () => {
  it('解析 message.images 里的 jpeg data URL，并读出 usage.cost', () => {
    const parsed = parseAiGatewayImageResponse({
      choices: [{
        message: {
          images: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg}` } }],
        },
      }],
      usage: { prompt_tokens: 20, completion_tokens: 1400, total_tokens: 1420, cost: 0.0393585 },
    })
    expect(parsed.shape).toBe('message-images')
    expect(parsed.images[0]?.mimeType).toBe('image/jpeg')
    expect(parsed.usage).toEqual({ promptTokens: 20, completionTokens: 1400, totalTokens: 1420, cost: 0.0393585 })
  })

  it('任务编号只接受本供应商的结果键', () => {
    const key = 'temporary/ai-gateway-results/00000000-0000-4000-8000-000000000901/0.img'
    const taskId = encodeAiGatewayTask({ key, mimeType: 'image/jpeg', usage: { cost: 0.0393585 } })
    expect(taskId.startsWith('ag1.')).toBe(true)
    expect(decodeAiGatewayTask(taskId)).toEqual({ key, mimeType: 'image/jpeg', usage: { cost: 0.0393585 } })
    expect(aiGatewayResultKey(aiGatewayResultUrl(key))).toBe(key)
    expect(aiGatewayResultKey('ai-gateway-object:temporary/openrouter-results/x/0.img')).toBeUndefined()
    expect(decodeAiGatewayTask('or1.abc')).toBeUndefined()
  })

  it('Images API 读取 b64_json，有 usage.cost 时不改写', () => {
    const parsed = parseAiGatewayImagesApiResponse({
      output_format: 'png',
      data: [{ b64_json: jpeg }],
      usage: { input_tokens: 100, output_tokens: 1756, total_tokens: 1856, cost: 0.04 },
    })
    expect(parsed.images[0]?.mimeType).toBe('image/png')
    expect(parsed.images[0]?.bytes.byteLength).toBe(MOCK_PNG_1X1.byteLength)
    expect(parsed.usage).toEqual({
      promptTokens: 100,
      completionTokens: 1756,
      totalTokens: 1856,
      cost: 0.04,
    })
  })

  it('没有 usage.cost 时按 $5/M 输入和 $30/M 输出估算，只有 total_tokens 时不估算', () => {
    expect(gatewayImageTokenCost(100, 1756)).toBe(0.05318)
    const derived = parseAiGatewayImagesApiResponse({
      data: [{ b64_json: jpeg }],
      usage: { input_tokens: 100, output_tokens: 1756, total_tokens: 1856 },
    })
    expect(derived.usage?.cost).toBe(0.05318)
    const totalOnly = parseAiGatewayImagesApiResponse({
      data: [{ b64_json: jpeg }],
      usage: { total_tokens: 1856 },
    })
    expect(totalOnly.usage?.cost).toBeUndefined()
    expect(totalOnly.usage?.totalTokens).toBe(1856)
  })
})
