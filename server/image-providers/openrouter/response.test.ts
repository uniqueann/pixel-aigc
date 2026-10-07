import { describe, expect, it } from 'vitest'
import { MOCK_PNG_1X1 } from '../mock.js'
import { parseOpenRouterImageResponse } from './response.js'

const png = Buffer.from(MOCK_PNG_1X1).toString('base64')
const dataUrl = `data:image/png;base64,${png}`

describe('OpenRouter 图片响应', () => {
  it('解析 message.images 里的 base64，并读出 token 与成本', () => {
    const parsed = parseOpenRouterImageResponse({
      choices: [{
        message: {
          role: 'assistant',
          content: '好的',
          images: [{ type: 'image_url', image_url: { url: dataUrl } }],
        },
      }],
      usage: { prompt_tokens: 12, completion_tokens: 1120, total_tokens: 1132, cost: 0.0336 },
    })
    expect(parsed.shape).toBe('message-images')
    expect(parsed.images).toHaveLength(1)
    expect(parsed.images[0].mimeType).toBe('image/png')
    expect(parsed.images[0].bytes).toEqual(MOCK_PNG_1X1)
    expect(parsed.usage).toEqual({ promptTokens: 12, completionTokens: 1120, totalTokens: 1132, cost: 0.0336 })
  })

  it('解析 content 数组和 inline_data', () => {
    const content = parseOpenRouterImageResponse({
      choices: [{ message: { content: [
        { type: 'text', text: '说明' },
        { type: 'image_url', image_url: { url: dataUrl } },
      ] } }],
    })
    expect(content.shape).toBe('message-content')
    expect(content.images[0].bytes).toEqual(MOCK_PNG_1X1)

    const inline = parseOpenRouterImageResponse({
      choices: [{ message: { content: [{ inline_data: { mime_type: 'image/png', data: png } }] } }],
    })
    expect(inline.shape).toBe('inline-data')
    expect(inline.images[0].mimeType).toBe('image/png')
    expect(inline.images[0].bytes).toEqual(MOCK_PNG_1X1)
  })

  it('没有图片时不编造结果', () => {
    expect(parseOpenRouterImageResponse({ choices: [{ message: { content: '只有文字' } }] }).images).toEqual([])
    expect(parseOpenRouterImageResponse({ usage: {} }).usage).toBeUndefined()
  })
})
