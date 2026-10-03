import type { ProviderContext } from '../../image-providers/types.js'
import { VideoProviderError, type VideoProvider, type VideoSubmitInput, type VideoTaskState } from '../types.js'
import { seedanceConfig } from './config.js'

export const VIDEO_MAX_BYTES = 100 * 1024 * 1024

export function mapSeedanceRequest(input: VideoSubmitInput) {
  return {
    model: input.model,
    content: [
      { type: 'text', text: input.prompt },
      ...(input.sourceImageUrl ? [{ type: 'image_url', image_url: { url: input.sourceImageUrl }, role: 'first_frame' }] : []),
    ],
    duration: input.durationSeconds, resolution: input.resolution,
    ratio: input.sourceImageUrl ? 'adaptive' : input.ratio,
    generate_audio: input.generateAudio, return_last_frame: true,
    execution_expires_after: 3600, callback_url: input.callbackUrl,
  }
}

function failure(code: string, status = 502) {
  if (/face|portrait|real.?person|real.?human|人脸|真人/i.test(code)) return new VideoProviderError('VIDEO_PORTRAIT_UNSUPPORTED', '首期暂不支持含真人人脸的图片，请使用非真人素材')
  if (/content|sensitive|risk|safety|moderation/i.test(code)) return new VideoProviderError('CONTENT_REJECTED', '视频内容未通过供应商审核，请调整描述或图片')
  if (status === 401 || status === 403) return new VideoProviderError('INVALID_KEY', '视频服务鉴权失败，请联系管理员')
  if (status === 429) return new VideoProviderError('RATE_LIMIT', '视频服务当前繁忙，请稍后重试', true)
  if (/expired|timeout/i.test(code)) return new VideoProviderError('TASK_TIMEOUT', '视频生成超时，积分将退回')
  return new VideoProviderError(status >= 500 ? 'UPSTREAM_UNAVAILABLE' : 'GENERATION_FAILED', '视频服务处理失败，请稍后重试', status >= 500, status >= 500)
}

async function request(method: 'POST' | 'GET', path: string, ctx: ProviderContext, body?: unknown) {
  const config = seedanceConfig()
  if (!config) throw new VideoProviderError('VIDEO_UNAVAILABLE', '视频服务配置不完整')
  let response: Response
  try {
    response = await ctx.fetch(`${config.baseUrl}/contents/generations/tasks${path}`, {
      method, headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: ctx.signal ? AbortSignal.any([ctx.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
    })
  } catch {
    // 创建请求可能已被上游接受，不能通过再次 POST 来重试。
    throw new VideoProviderError('UPSTREAM_UNAVAILABLE', '视频服务暂时未响应，正在确认任务状态', true, method === 'POST')
  }
  let data: Record<string, unknown>
  try { data = await response.json() as Record<string, unknown> }
  catch { throw new VideoProviderError('BAD_RESPONSE', '视频服务返回异常，正在确认任务状态', true, method === 'POST') }
  if (!response.ok) {
    const error = data.error as { code?: string; message?: string } | undefined
    throw failure(`${error?.code ?? ''} ${error?.message ?? ''}`, response.status)
  }
  return data
}

export const seedanceProvider: VideoProvider = {
  id: 'seedance',
  async submit(input, ctx) {
    const data = await request('POST', '', ctx, mapSeedanceRequest(input))
    if (typeof data.id !== 'string' || !/^cgt-[\w-]+$/.test(data.id)) throw new VideoProviderError('BAD_RESPONSE', '视频服务未返回任务标识，正在确认状态', true, true)
    return { providerTaskId: data.id }
  },
  async getStatus(id, ctx): Promise<VideoTaskState> {
    if (!/^cgt-[\w-]+$/.test(id)) throw new VideoProviderError('BAD_RESPONSE', '视频任务标识无效')
    const data = await request('GET', `/${encodeURIComponent(id)}`, ctx)
    if (data.id !== id || typeof data.model !== 'string') throw new VideoProviderError('BAD_RESPONSE', '视频任务响应不匹配', true)
    const common = { model: data.model, usage: data.usage as Record<string, number> | undefined }
    if (data.status === 'queued') return { ...common, state: 'queued' }
    if (data.status === 'running') return { ...common, state: 'processing' }
    if (data.status === 'succeeded') {
      const content = data.content as { video_url?: string; last_frame_url?: string } | undefined
      if (!content?.video_url) throw new VideoProviderError('BAD_RESPONSE', '视频服务没有返回结果地址', true)
      return { ...common, state: 'succeeded', videoUrl: content.video_url, posterUrl: content.last_frame_url }
    }
    if (['failed', 'expired', 'cancelled'].includes(String(data.status))) {
      const error = data.error as { code?: string; message?: string } | undefined
      const mapped = failure(`${data.status} ${error?.code ?? ''} ${error?.message ?? ''}`)
      return { ...common, state: 'failed', code: mapped.code, message: mapped.message }
    }
    throw new VideoProviderError('BAD_RESPONSE', '视频服务返回未知状态', true)
  },
  async fetchResult(url, ctx, maxBytes = VIDEO_MAX_BYTES) {
    let parsed: URL
    try { parsed = new URL(url) }
    catch { throw new VideoProviderError('VIDEO_RESULT_INVALID', '视频结果地址无效') }
    if (parsed.protocol !== 'https:' || !/\.(volces|volcengine)\.com$/.test(parsed.hostname)) throw new VideoProviderError('VIDEO_RESULT_INVALID', '视频结果地址无效')
    const signal = ctx.signal ? AbortSignal.any([ctx.signal, AbortSignal.timeout(100_000)]) : AbortSignal.timeout(100_000)
    const response = await ctx.fetch(url, { signal, redirect: 'error' })
    if (!response.ok || !response.body) throw new VideoProviderError('VIDEO_RESULT_DOWNLOAD', '视频结果读取失败', true)
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      if (Number(response.headers.get('content-length')) > maxBytes) throw new VideoProviderError('VIDEO_RESULT_TOO_LARGE', '视频结果超过文件大小限制')
      while (true) {
        const part = await reader.read()
        if (part.done) break
        size += part.value.byteLength
        if (size > maxBytes) throw new VideoProviderError('VIDEO_RESULT_TOO_LARGE', '视频结果超过文件大小限制')
        chunks.push(part.value)
      }
    } finally { await reader.cancel().catch(() => undefined) }
    return Buffer.concat(chunks, size)
  },
}
