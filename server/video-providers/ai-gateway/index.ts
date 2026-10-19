import { createHash } from 'node:crypto'
import { createGateway } from '@ai-sdk/gateway'
import { experimental_startVideo as startVideo, experimental_getVideoStatus as getVideoStatus, type StartVideoResult } from 'ai'
import { MINIMAX_H3_VIDEO_MODEL, type VideoResolution } from '../../../shared/video-models.js'
import { gatewayToken } from '../../ai-gateway-auth.js'
import type { ProviderContext } from '../../image-providers/types.js'
import { downloadVideoResult, VIDEO_MAX_BYTES } from '../download.js'
import { VideoProviderError, type VideoProvider } from '../types.js'

function failure(error: unknown, submitting: boolean): VideoProviderError {
  if (error instanceof VideoProviderError) return error
  const status = error && typeof error === 'object' && 'statusCode' in error ? Number(error.statusCode) : 0
  if (status === 401 || status === 403) return new VideoProviderError('INVALID_KEY', '视频服务鉴权或访问权限异常，请联系管理员')
  if (status === 402) return new VideoProviderError('PROVIDER_BALANCE', '平台视频服务额度暂不可用')
  if (status === 429) return new VideoProviderError('RATE_LIMIT', '视频服务当前繁忙，请稍后重试', !submitting)
  if (status >= 400 && status < 500) return new VideoProviderError('GENERATION_FAILED', '视频参数或内容未被供应商接受')
  return new VideoProviderError('UPSTREAM_UNAVAILABLE', submitting ? '正在确认视频任务状态' : '视频状态暂时无法查询', true, submitting)
}

async function model(ctx: ProviderContext) {
  let token: string
  try { token = await gatewayToken() } catch { throw new VideoProviderError('INVALID_KEY', '平台视频鉴权暂不可用') }
  if (!token) throw new VideoProviderError('INVALID_KEY', '平台视频鉴权暂不可用')
  return createGateway({ apiKey: token, fetch: ctx.fetch }).videoModel(MINIMAX_H3_VIDEO_MODEL.model)
}

function operationReference(value: unknown, id: string): StartVideoResult['operation'] {
  // operation 仅在服务端保存；旧记录有任务编号时可重建网关引用。
  if (value !== undefined && value !== null) return value as StartVideoResult['operation']
  return { gatewayJobId: id }
}

/** 只保存网关明确返回的费用和追踪编号，不把目录估价当成实际支出。 */
function traceMetadata(metadata: unknown) {
  const gateway = metadata && typeof metadata === 'object' && 'gateway' in metadata ? metadata.gateway : undefined
  if (!gateway || typeof gateway !== 'object') return {}
  const record = gateway as { generationId?: unknown; cost?: unknown }
  const cost = typeof record.cost === 'number' || (typeof record.cost === 'string' && record.cost.trim()) ? Number(record.cost) : undefined
  return { ...(typeof record.generationId === 'string' ? { generationId: record.generationId } : {}),
    ...(cost !== undefined && Number.isFinite(cost) && cost >= 0 ? { usage: { cost } } : {}) }
}

function resultResolution(metadata: unknown): VideoResolution | undefined {
  const minimax = metadata && typeof metadata === 'object' && 'minimax' in metadata ? metadata.minimax : undefined
  const value = minimax && typeof minimax === 'object' && 'resolution' in minimax ? minimax.resolution : undefined
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string' && ['768P', '2K'].includes(value.toUpperCase())) return value.toLowerCase() as VideoResolution
  throw new VideoProviderError('VIDEO_RESULT_INVALID', '供应商返回了不支持的视频档位')
}

export const aiGatewayVideoProvider: VideoProvider = {
  id: 'ai-gateway',
  async submit(input, ctx) {
    if (input.model !== MINIMAX_H3_VIDEO_MODEL.model || !['768p', '2k'].includes(input.resolution)
      || input.generateAudio !== true || (input.sourceImageUrl ? input.ratio !== 'adaptive' : input.ratio === 'adaptive')) {
      throw new VideoProviderError('VIDEO_PARAMS_INVALID', 'H3 支持原生有声的文生视频或单图首帧视频，分辨率请选择 768p、2K')
    }
    if (input.sourceImageUrl) {
      let image: URL
      try { image = new URL(input.sourceImageUrl) } catch { throw new VideoProviderError('VIDEO_PARAMS_INVALID', '视频首帧地址无效') }
      if (image.protocol !== 'https:' || image.username || image.password) throw new VideoProviderError('VIDEO_PARAMS_INVALID', '视频首帧地址无效')
    }
    try {
      const key = input.idempotencyKey ?? ctx.requestId
      if (!key) throw new VideoProviderError('VIDEO_PARAMS_INVALID', '视频请求缺少幂等标识')
      const selected = await model(ctx)
      const result = await startVideo({ model: selected,
        prompt: input.sourceImageUrl ? { image: input.sourceImageUrl, text: input.prompt } : input.prompt, n: 1,
        ...(!input.sourceImageUrl && input.ratio !== 'adaptive' ? { aspectRatio: input.ratio } : {}), duration: input.durationSeconds,
        providerOptions: { minimax: { resolution: input.resolution === '768p' ? '768P' : '2K' } },
        maxRetries: 0, abortSignal: AbortSignal.timeout(20_000),
        headers: { 'idempotency-key': createHash('sha256').update(key).digest('hex') } })
      const metadata = result.providerMetadata?.gateway?.asyncJob
      const operation = result.operation
      const id = metadata && typeof metadata === 'object' && 'jobId' in metadata ? metadata.jobId
        : operation && typeof operation === 'object' && !Array.isArray(operation) ? (operation as { gatewayJobId?: unknown }).gatewayJobId : undefined
      if (typeof id !== 'string' || !/^job_[\w-]+$/.test(id)) throw new VideoProviderError('BAD_RESPONSE', '视频服务未返回任务编号，正在确认状态', true, true)
      // 已受理的任务即使出现参数警告也要保存编号，等待查询后按失败退款。
      return { providerTaskId: id, operation: { reference: operation, unsupportedSettings: result.warnings.some(warning => warning.type === 'unsupported'), ...traceMetadata(result.providerMetadata) } }
    } catch (error) { throw failure(error, true) }
  },
  async getStatus(id, ctx, stored) {
    if (!/^job_[\w-]+$/.test(id)) throw new VideoProviderError('BAD_RESPONSE', '网关视频任务编号无效')
    const envelope = stored && typeof stored === 'object' ? stored as { reference?: unknown; unsupportedSettings?: boolean; generationId?: string; usage?: Record<string, number> } : undefined
    if (envelope?.unsupportedSettings) return { state: 'failed', model: MINIMAX_H3_VIDEO_MODEL.model, code: 'VIDEO_PARAMS_INVALID', message: '供应商未按所选参数生成，积分将退回' }
    try {
      const result = await getVideoStatus(await model(ctx), { operation: operationReference(envelope?.reference ?? stored, id), maxRetries: 0, abortSignal: ctx.signal })
      const common = { model: MINIMAX_H3_VIDEO_MODEL.model, ...(envelope?.generationId ? { generationId: envelope.generationId } : {}),
        ...(envelope?.usage ? { usage: envelope.usage } : {}), ...traceMetadata(result.providerMetadata) }
      if (result.status === 'pending') return { ...common, state: 'processing' }
      if (result.status === 'error') return { ...common, state: 'failed', code: 'GENERATION_FAILED', message: '供应商未完成视频生成，积分将退回' }
      if (result.warnings.some(warning => warning.type === 'unsupported') || result.videos.length !== 1) throw new VideoProviderError('VIDEO_RESULT_INVALID', '供应商结果与所选配置不匹配')
      const resolution = resultResolution(result.providerMetadata)
      const video = result.videos[0]
      if (video.type === 'url') return { ...common, resolution, state: 'succeeded', videoUrl: video.url }
      if (video.type === 'base64' && video.data.length > Math.ceil(VIDEO_MAX_BYTES / 3) * 4) throw new VideoProviderError('VIDEO_RESULT_TOO_LARGE', '视频结果超过文件大小限制')
      const bytes = video.type === 'base64' ? Buffer.from(video.data, 'base64') : video.data
      if (bytes.byteLength > VIDEO_MAX_BYTES) throw new VideoProviderError('VIDEO_RESULT_TOO_LARGE', '视频结果超过文件大小限制')
      return { ...common, resolution, state: 'succeeded', videoBytes: bytes }
    } catch (error) { throw failure(error, false) }
  },
  fetchResult: downloadVideoResult,
}
