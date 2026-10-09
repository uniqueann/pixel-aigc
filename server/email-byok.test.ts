import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateEmail } from './email-tasks'
import { emailModelAvailability } from './email-provider'
import { handleModelRoute } from './model-settings'

const params = { sourceText: '客户想知道订单何时送达', operation: 'reply' as const, language: 'zh' as const }
const response = (finish = 'stop') => new Response(JSON.stringify({ id: 'generation-1',
  choices: [{ finish_reason: finish, message: { content: '预计送达时间［待补充］。' } }],
  usage: { prompt_tokens: 42, completion_tokens: 23, total_tokens: 65, completion_tokens_details: { reasoning_tokens: 3 } },
}), { status: 200 })
beforeEach(() => {
  vi.stubEnv('EMAIL_ASSIST_ENABLED', 'true'); vi.stubEnv('DEEPSEEK_EMAIL_ENABLED', 'true'); vi.stubEnv('AI_GATEWAY_EMAIL_ENABLED', 'true')
  vi.stubEnv('CRON_SECRET', 'test-cron'); vi.stubEnv('DEEPSEEK_API_KEY', 'platform-deepseek'); vi.stubEnv('AI_GATEWAY_API_KEY', 'platform-gateway')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
describe('邮件平台模型调用', () => {
  it('DeepSeek 使用平台密钥、指定型号和关闭思考', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response()); vi.stubGlobal('fetch', fetchMock)
    const output = await generateEmail('deepseek:deepseek-flash', params)
    expect(output.resultText).toContain('预计送达')
    expect(output.tokenUsage).toMatchObject({ promptTokens: 42, reasoningTokens: 3 })
    const [url, request] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect(request.headers.Authorization).toBe('Bearer platform-deepseek')
    expect(JSON.parse(request.body)).toMatchObject({ model: 'deepseek-flash', thinking: { type: 'disabled' }, max_tokens: 1600 })
  })
  it('Gemini 使用 Gateway 鉴权、低思考档及总输出预算', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response()); vi.stubGlobal('fetch', fetchMock)
    const output = await generateEmail('ai-gateway:gemini-3.8-flash', { ...params, language: 'en-GB' })
    const [url, request] = fetchMock.mock.calls[0]
    expect(url).toBe('https://ai-gateway.vercel.sh/v1/chat/completions')
    expect(request.headers.Authorization).toBe('Bearer platform-gateway')
    expect(JSON.parse(request.body)).toMatchObject({ model: 'google/gemini-3.8-flash', reasoning_effort: 'low', max_tokens: 2048 })
    expect(JSON.parse(request.body).messages[0].content).toContain('英式英语')
    expect(output.vendor.generationId).toBe('generation-1')
  })
  it('总结不写成回复，回复保留缺失信息占位', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(response())); vi.stubGlobal('fetch', fetchMock)
    await generateEmail('deepseek:deepseek-v4-pro', { ...params, operation: 'summarize' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content).toContain('禁止写成回信')
    await generateEmail('deepseek:deepseek-v4-pro', params)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).messages[0].content).toContain('不擅自承诺')
  })
  it('截断、供应商鉴权和余额异常不会返回成功结果或要求用户配置密钥', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response('length'))
      .mockResolvedValueOnce(new Response('{}', { status: 401 })).mockResolvedValueOnce(new Response('{}', { status: 402 })))
    await expect(generateEmail('deepseek:deepseek-flash', params)).rejects.toMatchObject({ code: 'RESULT_TRUNCATED' })
    await expect(generateEmail('deepseek:deepseek-flash', params)).rejects.toMatchObject({ code: 'PROVIDER_AUTH', message: expect.stringContaining('平台') })
    await expect(generateEmail('deepseek:deepseek-flash', params)).rejects.toMatchObject({ code: 'PROVIDER_BALANCE', message: expect.stringContaining('平台') })
  })
  it('凭据存在也不会绕过开关；旧个人密钥接口直接停用', async () => {
    vi.stubEnv('EMAIL_ASSIST_ENABLED', 'false')
    expect(emailModelAvailability('deepseek:deepseek-flash').available).toBe(false)
    await expect(handleModelRoute({} as never, 'PUT', ['model-settings', 'deepseek'], { apiKey: 'user-key' })).rejects.toMatchObject({ status: 410, code: 'BYOK_REMOVED' })
  })
})
