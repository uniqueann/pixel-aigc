import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SEEDANCE_VIDEO_MODEL } from '../../../shared/video-models.js'
import type { ProviderContext } from '../../image-providers/types.js'
import { seedanceProvider, mapSeedanceRequest } from './index.js'
import { callbackToken, validCallbackToken, videoGenerationAvailable } from './config.js'

const input = { model: SEEDANCE_VIDEO_MODEL.model, prompt: '雨夜城市', durationSeconds: 5 as const, resolution: '720p' as const,
  ratio: '16:9' as const, generateAudio: false, callbackUrl: 'https://example.test/api/callback' }
function context(body: unknown, status = 200) {
  return { fetch: vi.fn(async () => Response.json(body, { status })), now: Date.now, sleep: async () => {}, log: vi.fn() } satisfies ProviderContext
}
beforeEach(() => {
  vi.stubEnv('ARK_API_KEY', '测试密钥')
  vi.stubEnv('VIDEO_PUBLIC_BASE_URL', 'https://example.test')
  vi.stubEnv('SEEDANCE_CALLBACK_SECRET', '测试回调密钥')
})
afterEach(() => vi.unstubAllEnvs())

describe('Seedance 官方接口适配', () => {
  it('显式关闭声音并固定请求规格，图生视频只使用单张首帧', () => {
    expect(mapSeedanceRequest(input)).toMatchObject({ model: input.model, duration: 5, resolution: '720p', ratio: '16:9',
      generate_audio: false, execution_expires_after: 3600, return_last_frame: true })
    expect(mapSeedanceRequest(input)).not.toHaveProperty('output_format')
    expect(mapSeedanceRequest({ ...input, sourceImageUrl: 'https://r2.test/source' })).toMatchObject({ ratio: 'adaptive',
      content: [{ type: 'text', text: input.prompt }, { type: 'image_url', image_url: { url: 'https://r2.test/source' }, role: 'first_frame' }] })
  })
  it('提交成功只调用一次；网络异常保留不确定状态，不重新创建', async () => {
    const ctx = context({ id: 'cgt-123' })
    await expect(seedanceProvider.submit(input, ctx)).resolves.toEqual({ providerTaskId: 'cgt-123' })
    expect(ctx.fetch).toHaveBeenCalledTimes(1)
    ctx.fetch.mockRejectedValue(new TypeError('网络中断'))
    await expect(seedanceProvider.submit(input, ctx)).rejects.toMatchObject({ ambiguous: true, retryable: true })
    expect(ctx.fetch).toHaveBeenCalledTimes(2)
  })
  it('真人图片审核错误返回明确提示，鉴权错误可以确定失败', async () => {
    await expect(seedanceProvider.submit(input, context({ error: { code: 'RealPersonNotSupported' } }, 400)))
      .rejects.toMatchObject({ code: 'VIDEO_PORTRAIT_UNSUPPORTED', ambiguous: false })
    await expect(seedanceProvider.submit(input, context({ error: {} }, 401))).rejects.toMatchObject({ code: 'INVALID_KEY', ambiguous: false })
  })
  it('状态查询验证任务身份，并保留真实结果地址和用量', async () => {
    await expect(seedanceProvider.getStatus('cgt-123', context({ id: 'cgt-123', model: input.model, status: 'succeeded',
      content: { video_url: 'https://a.volces.com/video.mp4', last_frame_url: 'https://a.volces.com/frame.jpg' }, usage: { completion_tokens: 42 } })))
      .resolves.toMatchObject({ state: 'succeeded', model: input.model, usage: { completion_tokens: 42 } })
    await expect(seedanceProvider.getStatus('cgt-123', context({ id: 'cgt-other', model: input.model, status: 'running' })))
      .rejects.toMatchObject({ code: 'BAD_RESPONSE' })
  })
  it('下载限制同时检查声明长度和实际字节，不访问任意外部地址', async () => {
    const ctx = context({})
    ctx.fetch.mockResolvedValue(new Response(new Uint8Array(8)))
    await expect(seedanceProvider.fetchResult('https://a.volces.com/video.mp4', ctx, 4)).rejects.toMatchObject({ code: 'VIDEO_RESULT_TOO_LARGE' })
    ctx.fetch.mockResolvedValue(new Response(new Uint8Array(1), { headers: { 'content-length': '9' } }))
    await expect(seedanceProvider.fetchResult('https://a.volces.com/video.mp4', ctx, 4)).rejects.toMatchObject({ code: 'VIDEO_RESULT_TOO_LARGE' })
    await expect(seedanceProvider.fetchResult('https://evil.test/video.mp4', ctx)).rejects.toMatchObject({ code: 'VIDEO_RESULT_INVALID' })
    expect(ctx.fetch).toHaveBeenCalledTimes(2)
    expect(ctx.fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }))
  })
  it('回调密钥绑定任务和环境；完整配置仍需显式打开生成开关', () => {
    const token = callbackToken('任务一', 'production')
    expect(validCallbackToken('任务一', 'production', token)).toBe(true)
    expect(validCallbackToken('任务二', 'production', token)).toBe(false)
    expect(validCallbackToken('任务一', 'preview', token)).toBe(false)
    const env = { ARK_API_KEY: 'key', VIDEO_PUBLIC_BASE_URL: 'https://example.test', SEEDANCE_CALLBACK_SECRET: 'secret',
      AIGC_DATABASE_URL: 'db', R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'a', R2_SECRET_ACCESS_KEY: 'a', R2_BUCKET: 'a', VIDEO_CRON_SECRET: 'a' }
    expect(videoGenerationAvailable(env)).toBe(false)
    expect(videoGenerationAvailable({ ...env, VIDEO_GENERATION_ENABLED: 'true' })).toBe(true)
  })
})
