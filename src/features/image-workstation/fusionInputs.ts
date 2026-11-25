import type { ImageAsset } from '@/editor/types'
import { i18n } from '@/i18n'
import zhWorkstation from '@/i18n/locales/zh-CN/workstation.json'
import { uploadTaskInput, type TaskInputUploadMetrics } from '@/services/api/upload'
import { blobFromImageSource } from './download'

export type FusionInputRole = 'product' | 'reference'
export type FusionInputStage = 'reading' | 'validating' | 'signing' | 'uploading' | 'ready' | 'failed' | 'cancelled'
export interface FusionInputStatus { stage: FusionInputStage; error?: string }
export interface FusionPreparationState {
  phase: 'preparing' | 'failed' | 'submitting' | 'submitted' | 'cancelled'
  product: FusionInputStatus
  reference: FusionInputStatus
}
export interface FusionInputMetrics extends TaskInputUploadMetrics {
  source: 'object' | 'cache' | 'upload'
  readMs: number
  elapsedMs: number
  uploadStarted?: number
  uploadEnded?: number
}
interface CachedInput { ownerId: string; asset: ImageAsset; key: string; uploadedAt: number }
interface PreparationOptions {
  ownerId: string
  signal: AbortSignal
  isCurrent: () => boolean
  onStatus: (role: FusionInputRole, status: FusionInputStatus) => void
}
export const FUSION_INPUT_CACHE_MS = 30 * 60_000
export const FUSION_INPUT_TIMEOUT_MS = 120_000
const FUSION_INPUT_LOG_PREFIX = `[${zhWorkstation.logs.fusionInput}]`

export function sameFusionInput(left?: ImageAsset, right?: ImageAsset) {
  if (!left || !right) return left === right
  return left.id === right.id && left.url === right.url && left.width === right.width && left.height === right.height
    && left.mimeType === right.mimeType && (left.objectKey ?? left.storage?.objectKey) === (right.objectKey ?? right.storage?.objectKey)
}
export function fusionAbortError() { return new DOMException(i18n.t('workstation:errors.fusionPrepCancelled'), 'AbortError') }
export function isPreparationCancelled(error: unknown) { return error instanceof Error && error.name === 'AbortError' }
export class FusionInputPreparationError extends Error {
  constructor(public failures: Partial<Record<FusionInputRole, string>>) {
    super(
      Object.entries(failures)
        .map(([role, error]) => i18n.t('workstation:errors.fusionSlotFailureEntry', {
          slot: i18n.t(role === 'product' ? 'workstation:fusion.productSlot' : 'workstation:fusion.referenceSlot'),
          error,
        }))
        .join(i18n.t('workstation:common.semicolon')),
    )
    this.name = 'FusionInputPreparationError'
  }
}
export function isFusionInputPreparationError(error: unknown): error is FusionInputPreparationError {
  // 热更新保留的准备实例可能来自旧模块，按错误契约识别而非比较构造器。
  return error instanceof Error && error.name === 'FusionInputPreparationError' && 'failures' in error
}

/** 只持有当前两个槽位的元数据与成功键，不复制图片或持久化临时对象身份。 */
export class FusionInputPreparation {
  private cache: Partial<Record<FusionInputRole, CachedInput>> = {}
  clear() { this.cache = {} }
  syncInputs(product?: ImageAsset, reference?: ImageAsset) {
    for (const [role, asset] of [['product', product], ['reference', reference]] as const) {
      if (this.cache[role] && !sameFusionInput(this.cache[role]?.asset, asset)) delete this.cache[role]
    }
  }
  async prepare(product: ImageAsset, reference: ImageAsset, options: PreparationOptions, keys: { product?: string; reference?: string } = {}) {
    this.syncInputs(product, reference)
    const preparationId = crypto.randomUUID()
    const started = performance.now()
    const measurements: Partial<Record<FusionInputRole, FusionInputMetrics>> = {}
    const check = () => {
      if (options.signal.aborted || !options.isCurrent()) throw fusionAbortError()
    }
    const read = async (role: FusionInputRole, asset: ImageAsset): Promise<string> => {
      const controller = new AbortController()
      const cancel = () => controller.abort(fusionAbortError())
      options.signal.addEventListener('abort', cancel, { once: true })
      if (options.signal.aborted) cancel()
      const timer = setTimeout(() => controller.abort(new Error(i18n.t('workstation:errors.fusionImageTimeout'))), FUSION_INPUT_TIMEOUT_MS)
      const signal = controller.signal
      const progress: { phase: FusionInputStage } = { phase: 'reading' }
      const metric: FusionInputMetrics = { source: 'upload', readMs: 0, elapsedMs: 0, validateMs: 0, signMs: 0, uploadMs: 0, inputBytes: 0, uploadedBytes: 0, outcome: 'failed' }
      const current = () => { check(); if (signal.aborted) throw signal.reason }
      const update = (status: FusionInputStatus) => { check(); options.onStatus(role, status) }
      try {
        current()
        const existing = keys[role] ?? asset.objectKey ?? asset.storage?.objectKey
        const cached = this.cache[role]
        const reused = existing ?? (cached?.ownerId === options.ownerId && sameFusionInput(cached.asset, asset) && Date.now() - cached.uploadedAt < FUSION_INPUT_CACHE_MS ? cached.key : undefined)
        if (reused) {
          metric.source = existing ? 'object' : 'cache'; metric.outcome = 'success'
          update({ stage: 'ready' })
          return reused
        }
        update({ stage: 'reading' })
        const readStarted = performance.now()
        let blob: Blob
        try { blob = await blobFromImageSource(asset.url, undefined, { ownerId: options.ownerId, signal }) }
        finally { metric.readMs = Math.round(performance.now() - readStarted) }
        current()
        metric.inputBytes = blob.size
        const key = await uploadTaskInput(blob, asset.mimeType, signal, {
          onPhase: stage => { current(); progress.phase = stage; if (stage === 'uploading') metric.uploadStarted = performance.now(); update({ stage }) },
          onMetrics: uploaded => { Object.assign(metric, uploaded); if (metric.uploadStarted !== undefined) metric.uploadEnded = performance.now() },
        })
        current()
        this.cache[role] = { ownerId: options.ownerId, asset: { ...asset }, key, uploadedAt: Date.now() }
        metric.outcome = 'success'
        update({ stage: 'ready' })
        return key
      } catch (error) {
        if (options.signal.aborted || !options.isCurrent()) { metric.outcome = 'cancelled'; throw fusionAbortError() }
        metric.outcome = 'failed'
        const raw = error instanceof Error ? error.message : ''
        const interruptedPhase = progress.phase === 'signing'
          ? i18n.t('workstation:errors.fusionPhaseSigning')
          : progress.phase === 'reading'
            ? i18n.t('workstation:errors.fusionPhaseReading')
            : i18n.t('workstation:errors.fusionPhaseUploading')
        const message = signal.aborted ? i18n.t('workstation:errors.fusionImageTimeout')
          : /timeout|timed out/i.test(raw) ? i18n.t('workstation:errors.fusionSignTimeout')
            : /failed to fetch|networkerror|network error|load failed/i.test(raw) ? i18n.t('workstation:errors.fusionPhaseInterrupted', { phase: interruptedPhase })
              : raw || i18n.t('workstation:errors.fusionImagePrepFailed')
        update({ stage: 'failed', error: message })
        throw Object.assign(new Error(message), { cause: error })
      } finally {
        clearTimeout(timer)
        options.signal.removeEventListener('abort', cancel)
        metric.elapsedMs = Math.round(performance.now() - started)
        measurements[role] = metric
        console.debug(FUSION_INPUT_LOG_PREFIX, { preparationId, role, ...metric })
      }
    }
    check()
    const results = await Promise.allSettled([read('product', product), read('reference', reference)])
    const productMetric = measurements.product!
    const referenceMetric = measurements.reference!
    const overlapMs = Math.max(0, Math.min(productMetric.uploadEnded ?? 0, referenceMetric.uploadEnded ?? 0) - Math.max(productMetric.uploadStarted ?? Infinity, referenceMetric.uploadStarted ?? Infinity))
    const outcome = options.signal.aborted || !options.isCurrent() ? 'cancelled' : results.some(result => result.status === 'rejected') ? 'failed' : 'success'
    console.debug(FUSION_INPUT_LOG_PREFIX, { preparationId, operation: 'complete', outcome, elapsedMs: Math.round(performance.now() - started), overlapMs: Math.round(overlapMs), putAttempts: Object.values(measurements).filter(metric => metric.uploadStarted !== undefined).length })
    check()
    const [productResult, referenceResult] = results
    if (productResult.status === 'rejected' || referenceResult.status === 'rejected') {
      throw new FusionInputPreparationError({
        ...(productResult.status === 'rejected' ? { product: productResult.reason.message } : {}),
        ...(referenceResult.status === 'rejected' ? { reference: referenceResult.reason.message } : {}),
      })
    }
    return { product: productResult.value, reference: referenceResult.value }
  }
}
