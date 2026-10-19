import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderContext } from '../../image-providers/types.js'
import { aiGatewayVideoProvider } from './index.js'
import { MINIMAX_H3_VIDEO_MODEL } from '../../../shared/video-models.js'
import type { VideoSubmitInput } from '../types.js'

const input: VideoSubmitInput = { model: MINIMAX_H3_VIDEO_MODEL.model, prompt: '商品在柔和灯光下缓慢旋转', durationSeconds: 5,
  resolution: '768p', ratio: '1:1', generateAudio: true, idempotencyKey: '账号与环境隔离的请求编号' }
const context = () => ({ fetch: vi.fn(), now: Date.now, sleep: vi.fn(), log: vi.fn(), requestId: 'request-one' } satisfies ProviderContext)
const accepted = { operation: { gatewayJobId: 'job_test' }, providerMetadata: { gateway: { asyncJob: { jobId: 'job_test' } } } }
beforeEach(() => vi.stubEnv('AI_GATEWAY_API_KEY', 'test-gateway-key'))
afterEach(() => vi.unstubAllEnvs())

describe('H3 Gateway 异步适配器', () => {
  it.each([['768p', '768P'], ['2k', '2K']] as const)('显式传递 %s 档位，保存 operation，创建只调用一次', async (resolution, tier) => {
    const ctx = context()
    ctx.fetch.mockResolvedValue(Response.json(accepted))
    const result = await aiGatewayVideoProvider.submit({ ...input, resolution }, ctx)
    expect(result).toEqual({ providerTaskId: 'job_test', operation: { reference: accepted.operation, unsupportedSettings: false } })
    expect(ctx.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = ctx.fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://ai-gateway.vercel.sh/v4/ai/video-model/start')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-gateway-key')
    expect(new Headers(init.headers).get('idempotency-key')).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.parse(init.body as string)).toMatchObject({ prompt: input.prompt, n: 1, aspectRatio: '1:1', duration: 5,
      providerOptions: { minimax: { resolution: tier } } })
    expect(JSON.parse(init.body as string)).not.toHaveProperty('generateAudio')
  })
  it('单图首帧保留 HTTPS URL，不发送比例、声音或内联图片', async () => {
    const ctx = context()
    ctx.fetch.mockResolvedValue(Response.json(accepted))
    await aiGatewayVideoProvider.submit({ ...input, ratio: 'adaptive', sourceImageUrl: 'https://r2.test/input.png?signature=test' }, ctx)
    const body = JSON.parse((ctx.fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body).toMatchObject({ prompt: input.prompt, image: { type: 'url', url: 'https://r2.test/input.png?signature=test' } })
    expect(body).not.toHaveProperty('aspectRatio')
    expect(body).not.toHaveProperty('generateAudio')
    expect(ctx.fetch).toHaveBeenCalledTimes(1)
  })
  it('状态查询使用持久化 operation，接收 URL 与内联字节，不创建新任务', async () => {
    const ctx = context()
    ctx.fetch.mockResolvedValueOnce(Response.json({ status: 'pending' }))
      .mockResolvedValueOnce(Response.json({ status: 'completed', videos: [{ type: 'url', url: 'https://cdn.hailuoai.com/a.mp4', mediaType: 'video/mp4' }], providerMetadata: { gateway: { generationId: 'gen-test', cost: '0.65' } } }))
      .mockResolvedValueOnce(Response.json({ status: 'completed', videos: [{ type: 'base64', data: Buffer.from('视频字节').toString('base64'), mediaType: 'video/mp4' }] }))
    const operation = { reference: { gatewayJobId: 'job_test', extra: '原始引用' } }
    expect(await aiGatewayVideoProvider.getStatus('job_test', ctx, operation)).toMatchObject({ state: 'processing' })
    expect(await aiGatewayVideoProvider.getStatus('job_test', ctx, operation)).toMatchObject({ state: 'succeeded', videoUrl: 'https://cdn.hailuoai.com/a.mp4', generationId: 'gen-test', usage: { cost: 0.65 } })
    expect(await aiGatewayVideoProvider.getStatus('job_test', ctx, operation)).toMatchObject({ state: 'succeeded', videoBytes: Buffer.from('视频字节') })
    for (const [url, init] of ctx.fetch.mock.calls as unknown as Array<[string, RequestInit]>) {
      expect(url).toContain('/video-model/status')
      expect(JSON.parse(init.body as string)).toEqual({ operation: operation.reference })
    }
  })
  it.each([401, 402, 429])('%i 明确拒绝可退款，且不会自动重试', async status => {
    const ctx = context()
    ctx.fetch.mockResolvedValue(Response.json({ error: { message: '平台服务错误' } }, { status }))
    await expect(aiGatewayVideoProvider.submit(input, ctx)).rejects.toMatchObject({ ambiguous: false })
    expect(ctx.fetch).toHaveBeenCalledTimes(1)
  })
  it('网络失败与损坏的创建响应保持提交不确定，不补发生成', async () => {
    const ctx = context()
    ctx.fetch.mockRejectedValue(new Error('连接断开'))
    await expect(aiGatewayVideoProvider.submit(input, ctx)).rejects.toMatchObject({ ambiguous: true })
    expect(ctx.fetch).toHaveBeenCalledTimes(1)
  })
  it('拒绝无声或非自适应首帧，参数忽略警告导致失败退款', async () => {
    const ctx = context()
    await expect(aiGatewayVideoProvider.submit({ ...input, sourceImageUrl: 'https://example.com/a.png' }, ctx)).rejects.toMatchObject({ code: 'VIDEO_PARAMS_INVALID' })
    await expect(aiGatewayVideoProvider.submit({ ...input, generateAudio: false }, ctx)).rejects.toMatchObject({ code: 'VIDEO_PARAMS_INVALID' })
    await expect(aiGatewayVideoProvider.submit({ ...input, ratio: 'adaptive', sourceImageUrl: 'data:image/png;base64,aA==' }, ctx)).rejects.toMatchObject({ code: 'VIDEO_PARAMS_INVALID' })
    expect(ctx.fetch).not.toHaveBeenCalled()
    ctx.fetch.mockResolvedValue(Response.json({ ...accepted, warnings: [{ type: 'unsupported', feature: 'resolution' }] }))
    const result = await aiGatewayVideoProvider.submit(input, ctx)
    expect(await aiGatewayVideoProvider.getStatus(result.providerTaskId, ctx, result.operation)).toMatchObject({ state: 'failed', code: 'VIDEO_PARAMS_INVALID' })
    expect(ctx.fetch).toHaveBeenCalledTimes(1)
  })
  it('完成结果保留实际档位，未知档位不能交付', async () => {
    const ctx = context()
    const completed = (resolution: string) => Response.json({ status: 'completed', videos: [{ type: 'url', url: 'https://cdn.test/a.mp4', mediaType: 'video/mp4' }], providerMetadata: { minimax: { resolution } } })
    ctx.fetch.mockResolvedValueOnce(completed('2K')).mockResolvedValueOnce(completed('480P'))
    expect(await aiGatewayVideoProvider.getStatus('job_test', ctx)).toMatchObject({ resolution: '2k' })
    await expect(aiGatewayVideoProvider.getStatus('job_test', ctx)).rejects.toMatchObject({ code: 'VIDEO_RESULT_INVALID' })
  })
})
