import { blobFromImageSource } from '@/features/image-workstation/download'
import { uploadImage, uploadTaskInput } from '@/services/api/upload'
import { normalizeImageBlob } from '@shared/image-format'
import { clientTiming, downloadImageResult, fileToBase64, imageAuthHeader, ImageResultError,
  readImageResult, shouldUseInlineImageTransport, throwIfImageRequestAborted } from '@/services/api/image-transfer'
import { createTask, getTask, liveCapabilityReady } from '@/services/api/task'
import { Capability } from '@/types'
import type { BatchImage } from './types'

const ACTIVE = new Set(['pending', 'queued', 'processing'])

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
  const ownerId = options.ownerId ?? 'local'
  const transfer = { ...(image.transfer?.ownerId === ownerId ? image.transfer : {}), ownerId }
  const saveTransfer = () => options.onTransfer?.({ ...transfer })
  const check = () => {
    throwIfImageRequestAborted(options.signal)
    if (shouldStop()) throw new DOMException('处理已取消', 'AbortError')
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
      transfer.result = undefined
      saveTransfer()
      throw error
    }
  }
  check()
  const started = performance.now()
  if (transfer.result) {
    try {
      const matte = await finish(await downloadImageResult(transfer.result, '抠图', options.signal))
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
  const source = await normalizeImageBlob(image.file)
  check()
  let uploadMs = 0
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let body: Record<string, unknown>
    if (shouldUseInlineImageTransport(source.size, 0, '', transfer.sourceImageKey)) {
      body = { mimeType: source.type, dataBase64: await fileToBase64(source) }
    } else {
      if (!transfer.sourceImageKey) {
        const uploadStarted = performance.now()
        transfer.sourceImageKey = await uploadTaskInput(source, source.type, timedSignal(120_000, options.signal))
        uploadMs += Math.round(performance.now() - uploadStarted)
        saveTransfer()
      }
      body = { sourceImageKey: transfer.sourceImageKey }
    }
    check()
    body.clientTimingMs = clientTiming(started, uploadMs)
    const response = await fetch('/api/bg-remove', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(await imageAuthHeader()) },
      body: JSON.stringify(body), signal: timedSignal(115_000, options.signal),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string; code?: string } | null
      if (response.status === 404 && payload?.code === 'OBJECT_NOT_FOUND' && transfer.sourceImageKey) {
        transfer.sourceImageKey = undefined
        saveTransfer()
        if (attempt === 0) continue
      }
      throw new Error(payload?.error || '抠图失败')
    }
    check()
    const downloadStarted = performance.now()
    const matte = await readImageResult(response, '抠图', {
      expectedMime: 'image/png', signal: options.signal,
      onObjectResult: result => { transfer.result = result; saveTransfer() },
    }).catch(error => {
      if (error instanceof ImageResultError && error.status === 200) { transfer.result = undefined; saveTransfer() }
      throw error
    })
    console.info(JSON.stringify({ evt: 'bg-remove-client', requestId: response.headers.get('X-Request-Id'),
      downloadMs: Math.round(performance.now() - downloadStarted), uploadMs, totalMs: Math.round(performance.now() - started) }))
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
