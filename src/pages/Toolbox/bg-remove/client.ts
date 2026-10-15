import { authorizeSyncQuote } from '@/services/api/billing'
import { postBilledSyncImage } from '@/services/api/billed-sync'
import { invalidateOwnedImage } from '@/services/api/ownedImages'
import { blobFromImageSource } from '@/features/image-workstation/download'
import { uploadImage, uploadTaskInput } from '@/services/api/upload'
import { normalizeImageBlob } from '@shared/image-format'
import { clientTiming, downloadImageResult, fileToBase64, ImageResultError,
  readImageResult, shouldUseInlineImageTransport, throwIfImageRequestAborted } from '@/services/api/image-transfer'
import { createTask, getTask, liveCapabilityReady } from '@/services/api/task'
import { Capability } from '@/types'
import { useUserStore } from '@/store/useUserStore'
import { BgRemoveSourceUploads, type BgRemoveSourceMetrics } from './sourceUpload'
import type { BatchImage } from './types'

const ACTIVE = new Set(['pending', 'queued', 'processing'])
const sourceUploads = new BgRemoveSourceUploads(uploadTaskInput)
let sessionVersion = 0
export function clearBgRemoveSourceUploadSession() { sessionVersion++; sourceUploads.clear() }
useUserStore.subscribe((state, previous) => {
  if (state.userId !== previous.userId || state.account?.runtimeScope !== previous.account?.runtimeScope)
    clearBgRemoveSourceUploadSession()
})

async function readSize(blob: Blob) {
  const bitmap = await createImageBitmap(blob)
  const size = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return size
}

interface MattingOptions {
  signal?: AbortSignal
  ownerId?: string
  onTransfer?: (transfer: NonNullable<BatchImage['transfer']>) => void
}

function timedSignal(timeout: number, signal?: AbortSignal) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout)
}

async function requestTencentMatte(image: BatchImage, shouldStop: () => boolean, options: MattingOptions) {
  const actor = useUserStore.getState()
  const ownerId = options.ownerId ?? actor.userId ?? 'local'
  const runtimeScope = actor.account?.runtimeScope ?? 'local'
  const scope = JSON.stringify([ownerId, runtimeScope])
  const version = sessionVersion
  const transfer = {
    ...(image.transfer?.ownerId === ownerId && (image.transfer.runtimeScope ?? 'local') === runtimeScope ? image.transfer : {}),
    ownerId, runtimeScope,
  }
  const saveTransfer = () => options.onTransfer?.({ ...transfer })
  const check = () => {
    throwIfImageRequestAborted(options.signal)
    if (shouldStop()) throw new DOMException('处理已取消', 'AbortError')
    const current = useUserStore.getState()
    if (version !== sessionVersion || (current.userId ?? 'local') !== ownerId
      || (current.account?.runtimeScope ?? 'local') !== runtimeScope)
      throw new DOMException('账号或环境已切换，旧抠图请求已停止', 'AbortError')
  }
  const finish = async (blob: Blob) => {
    check()
    try {
      const normalized = await normalizeImageBlob(blob)
      if (normalized.type !== 'image/png') throw new Error('抠图结果不是透明 PNG')
      const size = await readSize(normalized)
      if (size.width !== image.width || size.height !== image.height) throw new Error('抠图结果尺寸与原图不一致')
      check()
      return normalized
    } catch (error) {
      check()
      if (transfer.result) invalidateOwnedImage(ownerId, transfer.result.objectKey)
      transfer.result = undefined
      saveTransfer()
      throw error
    }
  }
  check()
  const started = performance.now()
  if (transfer.result) {
    try {
      const matte = await finish(await downloadImageResult(transfer.result, '抠图', options.signal, options.ownerId))
      console.info(JSON.stringify({ evt: 'bg-remove-client', resultReuse: true, downloadMs: Math.round(performance.now() - started) }))
      return matte
    }
    catch (error) {
      check()
      if (!(error instanceof ImageResultError) || error.status !== 404) {
        if (error instanceof ImageResultError && error.status === 200) { transfer.result = undefined; saveTransfer() }
        throw error
      }
      // 临时结果已清理，重新处理；普通下载错误仍保留结果，供下一次只重试下载。
      transfer.result = undefined
      saveTransfer()
    }
  }
  const quote = await authorizeSyncQuote('bg-remove', 1)
  const source = await normalizeImageBlob(image.file)
  check()
  let uploadMs = 0
  let sourceMetric: BgRemoveSourceMetrics | undefined
  for (let attempt = 0; attempt < 1; attempt += 1) {
    let body: Record<string, unknown>
    if (shouldUseInlineImageTransport(source.size, 0, '', transfer.sourceImageKey)) {
      body = { mimeType: source.type, dataBase64: await fileToBase64(source) }
    } else {
      if (!transfer.sourceImageKey) {
        const uploadStarted = performance.now()
        transfer.sourceImageKey = await sourceUploads.read(source, {
          scope, signal: timedSignal(120_000, options.signal),
          onMetrics: metrics => {
            sourceMetric = metrics
            // 摘要、对象键、文件名及签名地址均不写入耗时日志。
            console.info(JSON.stringify({ evt: 'bg-remove-upload', ...metrics, inputBytes: source.size }))
          },
        })
        check()
        if (sourceMetric?.source !== 'cache') uploadMs += Math.round(performance.now() - uploadStarted)
        saveTransfer()
      }
      body = { sourceImageKey: transfer.sourceImageKey }
    }
    check()
    body.clientTimingMs = clientTiming(started, uploadMs)
    const response = await postBilledSyncImage('bg-remove',body,quote,timedSignal(115_000,options.signal)).catch(error=>{
      check()
      if(error && typeof error === 'object' && 'code' in error && error.code === 'OBJECT_NOT_FOUND') {
        if (transfer.sourceImageKey) sourceUploads.invalidate(scope, transfer.sourceImageKey)
        transfer.sourceImageKey=undefined;saveTransfer()
      }
      throw error
    })
    check()
    const downloadStarted = performance.now()
    const matte = await readImageResult(response, '抠图', {
      expectedMime: 'image/png', signal: options.signal, ownerId: options.ownerId,
      onObjectResult: result => { check(); transfer.result = result; saveTransfer() },
    }).catch(error => {
      check()
      if (error instanceof ImageResultError && error.status === 200) { transfer.result = undefined; saveTransfer() }
      throw error
    })
    console.info(JSON.stringify({ evt: 'bg-remove-client', requestId: response.headers.get('X-Request-Id'),
      downloadMs: Math.round(performance.now() - downloadStarted), uploadMs,
      sourceReuse: sourceMetric?.source ?? (transfer.sourceImageKey ? 'item' : 'inline'),
      totalMs: Math.round(performance.now() - started) }))
    return finish(matte)
  }
  throw new Error('图片对象已过期，请重新上传')
}

export async function requestMatte(image: BatchImage, shouldStop: () => boolean, options: MattingOptions = {}) {
  if (!liveCapabilityReady(Capability.BgRemove)) {
    return requestTencentMatte(image, shouldStop, options)
  }
  const uploaded = await uploadImage(image.file)
  let current: Awaited<ReturnType<typeof getTask>> = await createTask({
    capability: Capability.BgRemove,
    requestId: crypto.randomUUID(),
    params: { sourceImageUrl: uploaded.url, size: { width: image.width, height: image.height } },
  })
  while (ACTIVE.has(current.status)) {
    if (shouldStop()) throw new Error('处理已取消')
    await new Promise(resolve => setTimeout(resolve, 2000))
    if (shouldStop()) throw new Error('处理已取消')
    current = await getTask(current.id)
  }
  if (current.status !== 'succeeded') throw new Error(current.errorMessage || '抠图失败')
  const url = current.resultUrls?.[0]
  if (!url) throw new Error('抠图没有返回图片')
  const blob = await blobFromImageSource(url, current.resultImages?.[0]?.objectKey)
  const size = await readSize(blob)
  if (size.width !== image.width || size.height !== image.height) throw new Error('抠图结果尺寸与原图不一致')
  return blob
}
