import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decryptKey, encryptKey } from './model-settings'
import { generateEmail } from './email-tasks'

const originalFetch = globalThis.fetch
const originalKey = process.env.AIGC_CREDENTIAL_KEY_V1
const originalScope = process.env.AIGC_RUNTIME_SCOPE
const params = { sourceText: '客户想知道订单何时送达', operation: 'reply' as const, language: 'zh' as const }

beforeEach(() => {
  process.env.AIGC_CREDENTIAL_KEY_V1 = Buffer.alloc(32, 7).toString('base64')
  process.env.AIGC_RUNTIME_SCOPE = 'local'
})
afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalKey === undefined) delete process.env.AIGC_CREDENTIAL_KEY_V1
  else process.env.AIGC_CREDENTIAL_KEY_V1 = originalKey
  if (originalScope === undefined) delete process.env.AIGC_RUNTIME_SCOPE
  else process.env.AIGC_RUNTIME_SCOPE = originalScope
})

describe('用户模型密钥与邮件调用', () => {
  it('密钥加密后不含明文，并绑定用户和环境', () => {
    const encrypted = encryptKey('test-secret-key-1234', 'user-a')
    expect(encrypted.ciphertext).not.toContain('test-secret-key')
    expect(decryptKey({ ...encrypted, key_version: 1 }, 'user-a')).toBe('test-secret-key-1234')
    expect(() => decryptKey({ ...encrypted, key_version: 1 }, 'user-b')).toThrow()
    process.env.AIGC_RUNTIME_SCOPE = 'preview'
    expect(() => decryptKey({ ...encrypted, key_version: 1 }, 'user-a')).toThrow()
  })
  it('使用用户密钥和指定模型，保存完整结果及 token 用量', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: '您好，预计送达时间［待补充］。' } }],
      usage: { prompt_tokens: 42, completion_tokens: 23, total_tokens: 65 },
    }), { status: 200 }))
    globalThis.fetch = fetchMock
    const output = await generateEmail('user-owned-key', 'deepseek-flash', params)
    expect(output).toEqual({ resultText: '您好，预计送达时间［待补充］。',
      tokenUsage: { promptTokens: 42, completionTokens: 23, totalTokens: 65 } })
    const [url, request] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect(request.headers.Authorization).toBe('Bearer user-owned-key')
    const body = JSON.parse(request.body)
    expect(body.model).toBe('deepseek-flash')
    expect(body.thinking).toEqual({ type: 'disabled' })
    expect(body.messages[1].content).toContain(params.sourceText)
    expect(body.user_id).toBeUndefined()
  })
  it('密钥无效与输出截断时不把异常内容当成成功结果', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '不完整' } }] }), { status: 200 }))
    await expect(generateEmail('bad-key', 'deepseek-flash', params)).rejects.toMatchObject({ code: 'INVALID_PROVIDER_KEY' })
    await expect(generateEmail('good-key', 'deepseek-flash', params)).rejects.toMatchObject({ code: 'RESULT_TRUNCATED' })
  })
})
