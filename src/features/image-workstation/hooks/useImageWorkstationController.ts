import { normalizeImageBlob } from '@shared/image-format'
import { readResultImage } from '../imageMetadata'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTaskPolling } from '@/hooks/useTaskPolling'
import { renderScaledSource } from '@/pages/Toolbox/aspect-ratio/outpaintClient'
import { requestErase } from '@/services/api/erase'
import { readOwnedImage, invalidateOwnedImage } from '@/services/api/ownedImages'
import { runtimeImageBlob } from '@/services/api/imageRuntime'
import { bindRuntimeImage, withRuntimeImage, setRuntimeImageUsers, releaseRuntimeImageUser, abandonPendingRuntimeImages } from '@/editor/runtimeImages'
import { downloadImageResult, type ImageResultReadOptions } from '@/services/api/image-transfer'
import type { SyncImageObjectResult } from '@shared/sync-image'
import type { ImageModelUi } from '@shared/image-models'
import { effectiveImageParameters } from '@/features/preferences/toolParameters'
import { historyIdForResult } from '@/features/assets/resultIdentity'
import { useUserStore } from '@/store/useUserStore'
import { paddingAround, requestOutpaint } from '@/services/api/outpaint'
import { validateOutpaintOutputSize } from '@shared/outpaint'
import { requestRepaint } from '@/services/api/repaint'
import { cloudEnabled } from '@/cloud/client'
import { liveCapabilityReady } from '@/services/api/task'
import { uploadDataUrl } from '@/services/api/upload'
import { imageObjectKey, taskInputKey } from '@/services/api/imageInput'
import { GenerationService } from '@/editor/services/generationService'
import { useEditorStore } from '@/editor/store'
import type { AssetId, GenerationId, ImageAsset } from '@/editor/types'
import { adaptGenerationTask, type TaskAdapterOptions } from '@/editor/adapters/taskAdapter'
import { useTaskStore } from '@/store/useTaskStore'
import { Capability, type GenerationTask, type ImageEditTaskParams, type InpaintTaskParams, type OutpaintTaskParams, type TaskStatus } from '@/types'
import { recordWorkstationHistory, type WorkstationHistoryRecord } from '@/features/assets/workstationHistory'
import { currentWorkstationHistoryOwner, isCurrentWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import { fusionHistoryText, readReferenceImageKey } from '@shared/fusion'
import { readRelight, relightHistoryText, type RelightOptions } from '@shared/relight'
import { readRetouchDirections, retouchHistoryText } from '@shared/retouch'
import { blobFromImageSource } from '../download'
import { remapMaskExportError } from '@/pages/ImageWorkstation/utils/maskExport'
import { isExactlySameImage, SOURCE_ECHO_ERROR } from '../sourceEcho'
import { finalizeWorkstationResults } from '../results'
import { COMING_SOON_SUBMIT_MESSAGE, isWorkstationToolReady } from '../tools/registry'
import { FusionInputPreparation, fusionAbortError, isFusionInputPreparationError, isPreparationCancelled, sameFusionInput, type FusionPreparationState } from '../fusionInputs'
import type {
  WorkstationCanvasHandle,
  WorkstationGenerationRequest,
  WorkstationToolDefinition,
} from '../types'

interface ControllerOptions {
  activeTool: WorkstationToolDefinition
  initialAsset?: ImageAsset
  prompt?: string
  count?: number
  resolution?: '1k' | '2k' | '4k'
  modelProfileId?: string
  modelUi?: ImageModelUi
  retouchDirections?: Array<'blemish' | 'brighten' | 'sharpen' | 'texture'>
  relight?: RelightOptions
  /** 融合使用独立的商品图，不沿用其他工具当前的原图。 */
  productAsset?: ImageAsset
  referenceAsset?: ImageAsset
  useProductAsset?: boolean
  /** 工作站自己的能力开关。裂变不写入全局 live capability。 */
  capabilityReady?: (capability: Capability) => boolean
}

interface SubmissionContext {
  request: WorkstationGenerationRequest
  options: TaskAdapterOptions & { inputAssetIds: AssetId[] }
  ownerId: string
  epoch: number
  referenceAsset?: ImageAsset
}
interface InputRetryContext {
  ownerId: string
  request: WorkstationGenerationRequest
  sourceAsset: ImageAsset
  referenceAsset: ImageAsset
  parentGenerationId?: GenerationId
}

const ACTIVE_STATUSES = new Set<TaskStatus>(['pending', 'queued', 'processing'])
const useMockGateway = import.meta.env.VITE_GENERATION_MODE === 'mock' && !cloudEnabled

function historyFailureMessage(error: unknown) {
  if (error && typeof error === 'object' && 'name' in error && error.name === 'QuotaExceededError') return '浏览器存储空间不足，历史未保存；当前图片仍可下载'
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : '历史未保存，请重试保存'
}

function isInlineUrl(url?: string) {
  return !!url && (url.startsWith('data:') || url.startsWith('blob:'))
}

async function blobFromAsset(asset: ImageAsset, message: string, options?: { ownerId: string; signal: AbortSignal }) {
  try {
    return await blobFromImageSource(asset.url, imageObjectKey(asset), options)
  } catch {
    if (options?.signal.aborted) throw fusionAbortError()
    throw new Error(message)
  }
}

async function prepareImageEditRequest(
  request: WorkstationGenerationRequest,
  sourceAsset: ImageAsset,
  options?: { ownerId: string; signal: AbortSignal },
): Promise<WorkstationGenerationRequest> {
  const uploadsSource = request.capability === Capability.ImageEdit || request.capability === Capability.Variation
  if (!uploadsSource || useMockGateway) return request
  const params = { ...(request.params as ImageEditTaskParams) }
  params.sourceImageKey ??= await taskInputKey(sourceAsset, '读取原图失败', options)
  params.sourceWidth = sourceAsset.width
  params.sourceHeight = sourceAsset.height
  if (isInlineUrl(params.sourceImageUrl)) delete params.sourceImageUrl
  if (isInlineUrl(params.referenceImageUrl)) delete params.referenceImageUrl
  return { ...request, params }
}

export function useImageWorkstationController({
  activeTool,
  initialAsset,
  prompt,
  count,
  resolution,
  modelProfileId,
  modelUi,
  retouchDirections,
  relight,
  productAsset,
  referenceAsset,
  useProductAsset = false,
  capabilityReady = liveCapabilityReady,
}: ControllerOptions) {
  const project = useEditorStore((state) => state.project)
  const createProject = useEditorStore((state) => state.createProject)
  const registerAsset = useEditorStore((state) => state.registerAsset)
  const registerGeneration = useEditorStore((state) => state.registerGeneration)
  const upsertTask = useTaskStore((state) => state.upsertTask)
  const [inputAssetId, setInputAssetId] = useState<AssetId | undefined>(initialAsset?.id)
  const [outputAssetIds, setOutputAssetIds] = useState<AssetId[]>([])
  const [activeTaskId, setActiveTaskId] = useState<string>()
  const [task, setTask] = useState<GenerationTask<unknown>>()
  const [submitting, setSubmitting] = useState(false)
  const [submissionError, setSubmissionError] = useState<string>()
  const [protocolError, setProtocolError] = useState<string>()
  const submissionsRef = useRef(new Map<string, SubmissionContext>())
  const handledTaskVersionsRef = useRef(new Set<string>())
  const runtimeUserRef = useRef({})
  const latestResultVersionRef = useRef<string>()
  const appliedTaskVersionsRef = useRef(new Set<string>())
  const readingVersionsRef = useRef(new Set<string>())
  const epochRef = useRef(0)
  const readAbortRef = useRef(new AbortController())
  const [readingResults, setReadingResults] = useState(false)
  const [resultReadError, setResultReadError] = useState<string>()
  const [historyError, setHistoryError] = useState<string>()
  const [historySaved, setHistorySaved] = useState(false)
  const failedSavesRef = useRef(new Map<string, { ownerId: string; record: WorkstationHistoryRecord; epoch: number }>())
  const syncRecoveryRef = useRef<{ descriptor: SyncImageObjectResult; complete: (blob: Blob) => Promise<GenerationTask<unknown>>; epoch: number; ownerId: string }>()
  const fusionInputsRef = useRef(new FusionInputPreparation())
  const inputRetryRef = useRef<InputRetryContext>()
  const [inputRetryRequest, setInputRetryRequest] = useState<WorkstationGenerationRequest>()
  const submissionGateRef = useRef<number>()
  const inputPreparationRef = useRef<FusionPreparationState>()
  const [inputPreparation, setInputPreparation] = useState<FusionPreparationState>()
  const updateInputPreparation = useCallback((value?: FusionPreparationState) => {
    inputPreparationRef.current = value
    setInputPreparation(value)
  }, [])
  const beginOperation = useCallback(() => {
    abandonPendingRuntimeImages(runtimeUserRef.current)
    readAbortRef.current.abort()
    readAbortRef.current = new AbortController()
    epochRef.current++
    latestResultVersionRef.current = undefined
    syncRecoveryRef.current = undefined
    setTask(undefined); setActiveTaskId(undefined)
    failedSavesRef.current.clear()
    setResultReadError(undefined); setHistoryError(undefined); setHistorySaved(false); setReadingResults(false)
    setSubmissionError(undefined); setProtocolError(undefined)
    inputRetryRef.current = undefined
    setInputRetryRequest(undefined)
    submissionGateRef.current = undefined
    updateInputPreparation(undefined)
    setSubmitting(false)
    return epochRef.current
  }, [updateInputPreparation])
  useEffect(() => {
    const epochState = epochRef
    const readState = readAbortRef
    const unsubscribe = useUserStore.subscribe((state, previous) => {
      if (state.userId !== previous.userId) {
        fusionInputsRef.current.clear()
        beginOperation(); setTask(undefined); setActiveTaskId(undefined); setOutputAssetIds([]); setInputAssetId(undefined)
      }
    })
    const fusionInputs = fusionInputsRef.current
    return () => { unsubscribe(); epochState.current++; readState.current.abort(); fusionInputs.clear() }
  }, [beginOperation])
  const inputIdentityRef = useRef({ tool: activeTool.slug, product: productAsset, reference: referenceAsset })
  useEffect(() => {
    const previous = inputIdentityRef.current
    const changed = previous.tool !== activeTool.slug || (activeTool.slug === 'fusion' && (!sameFusionInput(previous.product, productAsset) || !sameFusionInput(previous.reference, referenceAsset)))
    inputIdentityRef.current = { tool: activeTool.slug, product: productAsset, reference: referenceAsset }
    fusionInputsRef.current.syncInputs(productAsset, referenceAsset)
    if (changed) beginOperation()
  }, [activeTool.slug, beginOperation, productAsset, referenceAsset])

  useEffect(() => {
    if (!useEditorStore.getState().project) createProject('图片工作台')
  }, [createProject])

  useEffect(() => {
    if (!initialAsset) return
    registerAsset(initialAsset)
  }, [initialAsset, registerAsset])

  const service = useMemo(
    () => new GenerationService({ registerAsset, registerGeneration }),
    [registerAsset, registerGeneration],
  )
  const projectAsset = inputAssetId ? project?.assets[inputAssetId] : undefined
  const inputAsset = projectAsset?.type === 'image'
    ? withRuntimeImage(projectAsset)
    : initialAsset?.id === inputAssetId ? initialAsset : undefined
  const outputAssets = outputAssetIds.flatMap((assetId) => {
    const asset = project?.assets[assetId]
    return asset?.type === 'image' ? [withRuntimeImage(asset)] : []
  })

  useEffect(() => {
    const ids = [...outputAssetIds, ...(inputAssetId ? [inputAssetId] : [])]
    for (const outputId of outputAssetIds) {
      const asset = project?.assets[outputId]
      const generation = asset?.generationId ? project?.generations[asset.generationId] : undefined
      ids.push(...(generation?.inputAssetIds ?? []))
    }
    setRuntimeImageUsers(runtimeUserRef.current, ids)
  }, [inputAssetId, outputAssetIds, project])
  useEffect(() => {
    const user = runtimeUserRef.current
    return () => releaseRuntimeImageUser(user)
  }, [])

  const persistHistory = useCallback(async (
    completedTask: GenerationTask<unknown>, assets: ImageAsset[], ownerId: string, epoch: number,
  ) => {
    const directions = readRetouchDirections(completedTask.params)
    const referenceKey = readReferenceImageKey(completedTask.params)
    const light = readRelight(completedTask.params)
    const toolSlug = referenceKey ? 'fusion' : light ? 'relight' : directions.length ? 'retouch'
      : completedTask.capability === Capability.Inpaint ? ((completedTask.params as InpaintTaskParams).mode === 'repaint' ? 'repaint' : 'remove')
        : completedTask.capability === Capability.Outpaint ? 'outpaint' : completedTask.capability === Capability.Variation ? 'variation' : completedTask.capability === Capability.ImageEdit ? 'smart-edit' : activeTool.slug
    const note = typeof (completedTask.params as { prompt?: unknown })?.prompt === 'string' ? (completedTask.params as { prompt?: string }).prompt : undefined
    const prompt = referenceKey ? fusionHistoryText(note) : light ? relightHistoryText(light, note) : directions.length ? retouchHistoryText(directions, note) : note
    await Promise.all(assets.map(async asset => {
      const imageIndex = completedTask.resultImages?.findIndex(image => asset.objectKey ? image.objectKey === asset.objectKey : image.url === asset.url) ?? -1
      const index = imageIndex < 0 ? assets.indexOf(asset) : imageIndex
      const image = completedTask.resultImages?.[index]
      const id = historyIdForResult(completedTask.id, image ?? {}, index)
      try {
        const result = await normalizeImageBlob(await blobFromImageSource(withRuntimeImage(asset).url, asset.objectKey))
        if (!isCurrentWorkstationHistoryOwner(ownerId)) return
        const record: WorkstationHistoryRecord = { id, taskId: completedTask.id, ordinal: image?.ordinal, objectKey: asset.objectKey, toolSlug, capability: completedTask.capability, prompt,
          width: asset.width, height: asset.height, mimeType: result.type, result, createdAt: completedTask.createdAt, updatedAt: completedTask.updatedAt }
        if (epoch === epochRef.current) failedSavesRef.current.set(id, { ownerId, record, epoch })
        await recordWorkstationHistory(ownerId, record)
        failedSavesRef.current.delete(id)
      } catch (error) {
        if (epoch === epochRef.current && isCurrentWorkstationHistoryOwner(ownerId)) setHistoryError(historyFailureMessage(error))
      }
    }))
    if (epoch === epochRef.current && isCurrentWorkstationHistoryOwner(ownerId)) setHistorySaved(failedSavesRef.current.size === 0)
  }, [activeTool.slug])

  const applyCompletedTask = useCallback(async (
    completedTask: GenerationTask<unknown>, _assets: ImageAsset[], ownerId: string, inlineBlobs?: Blob[], operationEpoch = epochRef.current,
  ) => {
    if (completedTask.status !== 'succeeded' || !isCurrentWorkstationHistoryOwner(ownerId) || operationEpoch !== epochRef.current) return
    const version = `${completedTask.id}:${completedTask.updatedAt}`
    if (appliedTaskVersionsRef.current.has(version) || readingVersionsRef.current.has(version)) return
    latestResultVersionRef.current = version
    const context = submissionsRef.current.get(completedTask.id)
    const adapted = adaptGenerationTask(completedTask, { ...context?.options, existingAssets: Object.values(useEditorStore.getState().project?.assets ?? {}) })
    const finalized = finalizeWorkstationResults(completedTask, adapted.assets.filter((asset): asset is ImageAsset => asset.type === 'image'))
    if (finalized.error) { setProtocolError(finalized.error); return }
    readingVersionsRef.current.add(version)
    setReadingResults(true); setResultReadError(undefined)
    const successful: ImageAsset[] = []
    let failures = 0
    const signal = readAbortRef.current.signal
    const current = () => latestResultVersionRef.current === version && operationEpoch === epochRef.current && isCurrentWorkstationHistoryOwner(ownerId) && !signal.aborted
    try {
      await Promise.all(finalized.assets.map(async (asset, index) => {
        try {
          const image = completedTask.resultImages?.[index]
          const blob = inlineBlobs?.[index] ?? (runtimeImageBlob(withRuntimeImage(asset).url)
            ?? await (asset.objectKey ? readOwnedImage({ objectKey: asset.objectKey, url: asset.url, expiresAt: image?.expiresAt, mimeType: asset.mimeType }, { ownerId, signal }) : blobFromImageSource(asset.url)))
          const measured = await readResultImage(blob)
          if (image?.width && image?.height && (measured.width !== image.width || measured.height !== image.height)) throw new Error('结果尺寸与声明不一致')
          if (!current()) return
          const available = { ...asset, width: measured.width, height: measured.height, mimeType: measured.mimeType }
          registerAsset(available)
          bindRuntimeImage(ownerId, available, measured.blob, runtimeUserRef.current)
          successful.push(available)
          const order = finalized.assets.filter(candidate => successful.some(result => result.id === candidate.id))
          registerGeneration({ ...adapted.generation, outputAssetIds: order.map(result => result.id) })
          setOutputAssetIds(order.map(result => result.id))
          setInputAssetId(previous => previous && order.some(result => result.id === previous) ? previous : order[0].id)
          setProtocolError(undefined)
          void persistHistory(completedTask, [available], ownerId, operationEpoch)
        } catch (error) {
          if (asset.objectKey) invalidateOwnedImage(ownerId, asset.objectKey)
          failures++
          if (current()) setResultReadError(error instanceof Error ? error.message : '结果读取失败，请重试读取')
        }
      }))
      if (current() && failures === 0) appliedTaskVersionsRef.current.add(version)
    } finally {
      readingVersionsRef.current.delete(version)
      if (current()) setReadingResults(false)
    }
  }, [persistHistory, registerAsset, registerGeneration])

  const handlePolledTask = useCallback((nextTask: GenerationTask<unknown>) => {
    const context = submissionsRef.current.get(nextTask.id)
    if (!context || context.epoch !== epochRef.current || !isCurrentWorkstationHistoryOwner(context.ownerId)) return
    const version = `${nextTask.id}:${nextTask.status}:${nextTask.updatedAt}`
    if (handledTaskVersionsRef.current.has(version)) return
    handledTaskVersionsRef.current.add(version)
    setTask(nextTask)
    const adapted = service.reconcile(nextTask, { ...context.options, existingAssets: Object.values(useEditorStore.getState().project?.assets ?? {}), deferAssets: nextTask.status === 'succeeded' })
    void applyCompletedTask(nextTask, adapted.assets.filter((asset): asset is ImageAsset => asset.type === 'image'), context.ownerId, undefined, context.epoch)
  }, [applyCompletedTask, service])
  const taskQuery = useTaskPolling(activeTaskId, handlePolledTask)

  const completeSync = useCallback(async (input: {
    sourceAsset: ImageAsset; capability: Capability; params: InpaintTaskParams | OutpaintTaskParams; parentGenerationId?: GenerationId
    prepare: (original: Blob) => Promise<{ execute: (options: ImageResultReadOptions) => Promise<Blob>; compare?: Blob; targetSize?: { width: number; height: number } }>
  }) => {
    const ownerId = currentWorkstationHistoryOwner()
    const epoch = beginOperation()
    const signal = readAbortRef.current.signal
    setSubmitting(true)
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    let descriptor: SyncImageObjectResult | undefined
    const current = () => epoch === epochRef.current && isCurrentWorkstationHistoryOwner(ownerId)
    try {
      const original = await blobFromAsset(input.sourceAsset, '读取原图失败', { ownerId, signal })
      const prepared = await input.prepare(original)
      if (!current() || signal.aborted) throw new DOMException('处理已取消', 'AbortError')
      const completed: GenerationTask<unknown> = { id, capability: input.capability, status: 'succeeded', params: input.params, creditsCost: 0, createdAt: now, updatedAt: now }
      const complete = async (result: Blob) => {
        const measured = await readResultImage(result)
        if (!current()) return completed
        if (prepared.targetSize && (measured.width !== prepared.targetSize.width || measured.height !== prepared.targetSize.height)) throw new Error('扩图结果尺寸与目标不一致，请重试读取')
        if (prepared.compare && await isExactlySameImage(prepared.compare, measured.blob)) { setProtocolError(SOURCE_ECHO_ERROR); return completed }
        // 项目只保存可恢复的对象身份；本地展示地址由运行时租约持有。
        const url = descriptor?.url ?? `/local-image/${encodeURIComponent(id)}`
        completed.resultUrls = [url]
        completed.resultImages = [{ url, objectKey: descriptor?.objectKey, expiresAt: descriptor?.expiresAt, ordinal: 0, width: measured.width, height: measured.height, mimeType: measured.mimeType }]
        const options = { inputAssetIds: [input.sourceAsset.id], parentGenerationId: input.parentGenerationId, outputSize: { width: measured.width, height: measured.height } }
        submissionsRef.current.set(id, { request: { capability: input.capability, params: input.params, outputSize: options.outputSize }, options, ownerId, epoch })
        service.reconcile(completed, { ...options, deferAssets: true })
        setTask({ ...completed }); upsertTask(completed); setActiveTaskId(undefined)
        await applyCompletedTask(completed, [], ownerId, [measured.blob], epoch)
        if (current()) syncRecoveryRef.current = undefined
        return completed
      }
      const result = await prepared.execute({ ownerId, signal, onObjectResult: object => {
        descriptor = object
        if (!current()) return
        syncRecoveryRef.current = { descriptor: object, complete, epoch, ownerId }
        completed.resultUrls = [object.url]
        completed.resultImages = [{ ...object, width: prepared.targetSize?.width ?? 0, height: prepared.targetSize?.height ?? 0, ordinal: 0 }]
        setTask({ ...completed }); setActiveTaskId(undefined); setReadingResults(true)
      } })
      return await complete(result)
    } catch (error) {
      if (current()) {
        const message = error instanceof Error ? error.message : '处理失败'
        if (descriptor) setResultReadError(message)
        else setSubmissionError(message)
      }
      throw error
    } finally { if (current()) { setSubmitting(false); setReadingResults(false) } }
  }, [applyCompletedTask, beginOperation, service, upsertTask])

  const completeRepaint = useCallback((sourceAsset: ImageAsset, promptText: string, maskDataUrl: string, parentGenerationId?: GenerationId) => completeSync({
    sourceAsset, capability: Capability.Inpaint, params: { sourceImageUrl: sourceAsset.url, maskUrl: maskDataUrl, mode: 'repaint', prompt: promptText }, parentGenerationId,
    prepare: async original => ({ compare: original, execute: options => requestRepaint(imageObjectKey(sourceAsset) ? null : original, maskDataUrl, promptText, imageObjectKey(sourceAsset), options) }),
  }), [completeSync])
  const completeErase = useCallback((sourceAsset: ImageAsset, maskDataUrl: string, prompt: string, parentGenerationId?: GenerationId) => completeSync({
    sourceAsset, capability: Capability.Inpaint, params: { sourceImageUrl: sourceAsset.url, maskUrl: maskDataUrl, mode: 'remove', prompt: prompt || undefined }, parentGenerationId,
    prepare: async original => ({ compare: original, execute: options => requestErase(imageObjectKey(sourceAsset) ? null : original, original.type, maskDataUrl, prompt, imageObjectKey(sourceAsset), options) }),
  }), [completeSync])
  const completeOutpaint = useCallback((sourceAsset: ImageAsset, targetSize: { width: number; height: number }, originOffset: { x: number; y: number }, sourceSize: { width: number; height: number }, parentGenerationId?: GenerationId) => completeSync({
    sourceAsset, capability: Capability.Outpaint, params: { sourceImageUrl: sourceAsset.url, targetSize, originOffset, sourceSize }, parentGenerationId,
    prepare: async original => {
      validateOutpaintOutputSize(targetSize.width, targetSize.height)
      const padding = paddingAround(sourceSize.width, sourceSize.height, originOffset.x, originOffset.y, targetSize.width, targetSize.height)
      const needsScale = sourceSize.width !== sourceAsset.width || sourceSize.height !== sourceAsset.height
      const input = needsScale ? await renderScaledSource(new File([original], sourceAsset.name || 'source.jpg', { type: original.type }), sourceSize.width, sourceSize.height) : original
      const hasPad = padding.left + padding.right + padding.top + padding.bottom > 0
      return { targetSize, compare: hasPad ? input : undefined, execute: options => hasPad ? requestOutpaint(imageObjectKey(sourceAsset) && !needsScale ? null : input, input.type, padding, needsScale ? undefined : imageObjectKey(sourceAsset), {...options,sourceSize}) : Promise.resolve(input) }
    },
  }), [completeSync])

  const retryRead = useCallback(async () => {
    const epoch = epochRef.current
    setResultReadError(undefined); setReadingResults(true)
    const recovery = syncRecoveryRef.current
    try {
      if (recovery && recovery.epoch === epochRef.current) await recovery.complete(await downloadImageResult(recovery.descriptor, '图片', readAbortRef.current.signal, recovery.ownerId))
      else if (task?.status === 'succeeded') {
        const context = submissionsRef.current.get(task.id)
        if (context) await applyCompletedTask(task, [], context.ownerId, undefined, context.epoch)
      }
    } catch (error) { if (epoch === epochRef.current) setResultReadError(error instanceof Error ? error.message : '读取失败，请重试读取') }
    finally { if (epoch === epochRef.current) setReadingResults(false) }
  }, [applyCompletedTask, task])
  const retrySave = useCallback(async () => {
    setHistoryError(undefined)
    const epoch = epochRef.current
    const outcomes = await Promise.allSettled([...failedSavesRef.current].map(async ([id, entry]) => {
      if (entry.epoch !== epoch || !isCurrentWorkstationHistoryOwner(entry.ownerId)) return
      await recordWorkstationHistory(entry.ownerId, entry.record)
      failedSavesRef.current.delete(id)
    }))
    if (epoch !== epochRef.current) return
    const failed = outcomes.find(result => result.status === 'rejected')
    if (failed?.status === 'rejected') setHistoryError(historyFailureMessage(failed.reason))
    setHistorySaved(failedSavesRef.current.size === 0)
  }, [])

  const submitRequest = useCallback(async (
    request: WorkstationGenerationRequest,
    sourceAsset: ImageAsset,
    parentGenerationId: GenerationId | undefined,
    fusionReference?: ImageAsset,
  ) => {
    if (submissionGateRef.current !== undefined) throw new Error('请等待当前提交完成')
    const ownerId = currentWorkstationHistoryOwner()
    const epoch = beginOperation()
    const signal = readAbortRef.current.signal
    const isCurrent = () => epoch === epochRef.current && isCurrentWorkstationHistoryOwner(ownerId) && !signal.aborted
    submissionGateRef.current = epoch
    setSubmitting(true)
    const options: SubmissionContext['options'] = {
      inputAssetIds: fusionReference ? [sourceAsset.id, fusionReference.id] : [sourceAsset.id],
      parentGenerationId,
      outputSize: request.outputSize,
    }
    const snapshot: InputRetryContext | undefined = fusionReference ? {
      ownerId, request: { ...request, modelProfileId: request.modelProfileId ?? modelProfileId, params: { ...request.params } },
      sourceAsset: { ...sourceAsset }, referenceAsset: { ...fusionReference }, parentGenerationId,
    } : undefined
    try {
      let prepared: WorkstationGenerationRequest
      if (snapshot && !useMockGateway) {
        updateInputPreparation({ phase: 'preparing', product: { stage: 'reading' }, reference: { stage: 'reading' } })
        const params = { ...(snapshot.request.params as ImageEditTaskParams) }
        const keys = await fusionInputsRef.current.prepare(snapshot.sourceAsset, snapshot.referenceAsset, {
          ownerId, signal, isCurrent,
          onStatus: (role, status) => {
            if (isCurrent() && inputPreparationRef.current) updateInputPreparation({ ...inputPreparationRef.current, [role]: status })
          },
        }, { product: params.sourceImageKey, reference: params.referenceImageKey })
        params.sourceImageKey = keys.product
        params.referenceImageKey = keys.reference
        params.sourceWidth = sourceAsset.width
        params.sourceHeight = sourceAsset.height
        if (isInlineUrl(params.sourceImageUrl)) delete params.sourceImageUrl
        if (isInlineUrl(params.referenceImageUrl)) delete params.referenceImageUrl
        prepared = { ...snapshot.request, params }
        if (inputPreparationRef.current) updateInputPreparation({ ...inputPreparationRef.current, phase: 'submitting' })
      } else prepared = await prepareImageEditRequest(request, sourceAsset, { ownerId, signal })
      if (!isCurrent()) throw fusionAbortError()
      const result = await service.submit({
        capability: prepared.capability,
        requestId: crypto.randomUUID(),
        params: prepared.params,
        modelProfileId: prepared.modelProfileId ?? modelProfileId,
      }, { ...options, deferAssets: true, canApply: isCurrent })
      if (!isCurrent()) throw fusionAbortError()
      if (inputPreparationRef.current) updateInputPreparation({ ...inputPreparationRef.current, phase: 'submitted' })
      submissionsRef.current.set(result.task.id, { request: prepared, options, ownerId, epoch, referenceAsset: fusionReference })
      setTask(result.task as GenerationTask<unknown>)
      upsertTask(result.task as GenerationTask<unknown>)
      setActiveTaskId(result.task.id)
      void applyCompletedTask(
        result.task as GenerationTask<unknown>,
        result.assets.filter((asset): asset is ImageAsset => asset.type === 'image'),
        ownerId,
      )
      return result.task
    } catch (error) {
      if (!isCurrent() || isPreparationCancelled(error)) throw fusionAbortError()
      if (isFusionInputPreparationError(error) && snapshot) {
        inputRetryRef.current = snapshot
        setInputRetryRequest(snapshot.request)
        if (inputPreparationRef.current) updateInputPreparation({ ...inputPreparationRef.current, phase: 'failed' })
      } else {
        updateInputPreparation(undefined)
        setSubmissionError(error instanceof Error ? error.message : '生成任务提交失败')
      }
      throw error
    } finally {
      if (epoch === epochRef.current) { submissionGateRef.current = undefined; setSubmitting(false) }
    }
  }, [applyCompletedTask, beginOperation, modelProfileId, service, updateInputPreparation, upsertTask])

  const retryInputPreparation = useCallback(async () => {
    const snapshot = inputRetryRef.current
    if (!snapshot || submissionGateRef.current !== undefined || !isCurrentWorkstationHistoryOwner(snapshot.ownerId)) return
    if (!capabilityReady(Capability.Fusion)) throw new Error(COMING_SOON_SUBMIT_MESSAGE)
    return submitRequest(snapshot.request, snapshot.sourceAsset, snapshot.parentGenerationId, snapshot.referenceAsset)
  }, [capabilityReady, submitRequest])
  const cancelInputPreparation = useCallback(() => {
    const state = inputPreparationRef.current
    if (state?.phase !== 'preparing') return
    beginOperation()
    updateInputPreparation({ ...state, phase: 'cancelled', product: state.product.stage === 'ready' ? state.product : { stage: 'cancelled' }, reference: state.reference.stage === 'ready' ? state.reference : { stage: 'cancelled' } })
  }, [beginOperation, updateInputPreparation])

  const generate = useCallback(async (canvasHandle: WorkstationCanvasHandle | null) => {
    if (submissionGateRef.current !== undefined) throw new Error('请等待当前提交完成')
    const sourceOwner = currentWorkstationHistoryOwner()
    const sourceEpoch = epochRef.current
    if (!isWorkstationToolReady(activeTool, capabilityReady)) throw new Error(COMING_SOON_SUBMIT_MESSAGE)
    const product = useProductAsset ? productAsset : inputAsset
    if (activeTool.slug === 'fusion' && (!product || !referenceAsset?.url)) {
      throw new Error('请先上传商品图和场景图')
    }
    if (!product) throw new Error('请先上传需要编辑的图片')
    registerAsset(useEditorStore.getState().project?.assets[product.id] ?? product)
    if (activeTool.slug === 'fusion' && referenceAsset) registerAsset(referenceAsset)
    const effective = effectiveImageParameters(count ?? 1, resolution ?? '2k', product, modelUi)
    const initialContext = {
      sourceAsset: product,
      referenceAsset,
      prompt,
      count: effective.count,
      resolution: effective.resolution,
      modelProfileId,
      retouchDirections,
      relight,
    }
    const validation = activeTool.validate?.(initialContext)
    if (validation && !validation.valid) throw new Error(validation.message ?? '当前参数不完整')

    if (activeTool.slug === 'repaint' && !liveCapabilityReady(Capability.Inpaint)) {
      if (!canvasHandle?.exportMask) throw new Error('蒙版画布尚未准备好')
      try {
        return completeRepaint(product, prompt?.trim() ?? '', canvasHandle.exportMask().maskDataUrl, product.generationId)
      } catch (error) {
        throw remapMaskExportError(error, 'repaint')
      }
    }

    if (activeTool.capability === Capability.Outpaint && !liveCapabilityReady(Capability.Outpaint)) {
      if (!canvasHandle?.getTargetSize || !canvasHandle.getOriginOffset) throw new Error('扩图画布尚未准备好')
      return completeOutpaint(
        product,
        canvasHandle.getTargetSize(),
        canvasHandle.getOriginOffset(),
        canvasHandle.getSourceSize?.() ?? { width: product.width, height: product.height },
        product.generationId,
      )
    }

    if (activeTool.slug === 'remove' && !liveCapabilityReady(Capability.Inpaint)) {
      if (!canvasHandle?.exportMask) throw new Error('蒙版画布尚未准备好')
      try {
        return completeErase(product, canvasHandle.exportMask().maskDataUrl, prompt ?? '', product.generationId)
      } catch (error) {
        throw remapMaskExportError(error, 'remove')
      }
    }

    let canvasContext = {}
    if (activeTool.interactionMode !== 'params-only' && activeTool.interactionMode !== 'multi-source') {
      if (!canvasHandle) throw new Error('当前工具的画布交互仍在后续迭代中')
      const mask = canvasHandle.exportMask()
      const maskUrl = await uploadDataUrl(mask.maskDataUrl)
      if (!isCurrentWorkstationHistoryOwner(sourceOwner) || sourceEpoch !== epochRef.current) throw new DOMException('提交已取消', 'AbortError')
      canvasContext = {
        maskUrl,
        targetSize: canvasHandle.getTargetSize?.(),
        originOffset: canvasHandle.getOriginOffset?.(),
      }
    }

    const request = activeTool.buildRequest({ ...initialContext, ...canvasContext })
    return submitRequest({ ...request, modelProfileId }, product, product.generationId, activeTool.slug === 'fusion' ? referenceAsset : undefined)
  }, [activeTool, capabilityReady, completeErase, completeOutpaint, completeRepaint, count, inputAsset, modelProfileId, modelUi, productAsset, prompt, referenceAsset, registerAsset, relight, resolution, retouchDirections, submitRequest, useProductAsset])

  const retry = useCallback(async () => {
    if (task?.status === 'succeeded') return retryRead()
    if (!task) return
    const context = submissionsRef.current.get(task.id)
    const sourceAssetId = context?.options.inputAssetIds[0]
    const sourceAsset = sourceAssetId
      ? useEditorStore.getState().project?.assets[sourceAssetId]
      : undefined
    if (!context || sourceAsset?.type !== 'image') return
    const inpaintParams = context.request.capability === Capability.Inpaint
      ? context.request.params as InpaintTaskParams
      : undefined
    if (inpaintParams?.mode === 'repaint' && !liveCapabilityReady(Capability.Inpaint)) {
      if (!inpaintParams.maskUrl) throw new Error('请重新涂抹后再试')
      return completeRepaint(sourceAsset, inpaintParams.prompt ?? '', inpaintParams.maskUrl, context.options.parentGenerationId)
    }
    if (inpaintParams?.mode === 'remove' && !liveCapabilityReady(Capability.Inpaint)) {
      if (!inpaintParams.maskUrl) throw new Error('请先涂抹要消除的区域')
      return completeErase(sourceAsset, inpaintParams.maskUrl, inpaintParams.prompt ?? '', context.options.parentGenerationId)
    }
    if (context.request.capability !== Capability.Outpaint && !capabilityReady(context.request.capability)) {
      throw new Error(COMING_SOON_SUBMIT_MESSAGE)
    }
    if (context.request.capability === Capability.Outpaint && !liveCapabilityReady(Capability.Outpaint)) {
      const params = context.request.params as OutpaintTaskParams
      if (!params.targetSize || !params.originOffset) throw new Error('扩图画布尚未准备好')
      return completeOutpaint(
        sourceAsset,
        params.targetSize,
        params.originOffset,
        params.sourceSize ?? { width: sourceAsset.width, height: sourceAsset.height },
        context.options.parentGenerationId,
      )
    }
    return submitRequest(context.request, sourceAsset, context.options.parentGenerationId, context.referenceAsset)
  }, [capabilityReady, completeErase, completeOutpaint, completeRepaint, submitRequest, task, retryRead])

  const modifyParameters = useCallback(() => {
    beginOperation()
    setTask(undefined)
    setActiveTaskId(undefined)
    setSubmissionError(undefined)
    setProtocolError(undefined)
  }, [beginOperation])

  const replaceSourceAsset = useCallback((asset: ImageAsset) => {
    beginOperation()
    if (!useEditorStore.getState().project) createProject('图片工作台', { width: asset.width, height: asset.height })
    registerAsset(asset)
    setInputAssetId(asset.id)
    setOutputAssetIds([])
    setTask(undefined)
    setActiveTaskId(undefined)
    setSubmissionError(undefined)
    setProtocolError(undefined)
  }, [beginOperation, createProject, registerAsset])

  const selectOutput = useCallback((assetId: AssetId) => {
    const asset = useEditorStore.getState().project?.assets[assetId]
    if (asset?.type === 'image' && outputAssetIds.includes(assetId)) setInputAssetId(assetId)
  }, [outputAssetIds])

  const status = task?.status
  return {
    inputAsset,
    outputAssets,
    activeTask: task,
    submitting,
    active: !!status && ACTIVE_STATUSES.has(status),
    formLocked: submitting || readingResults || (!!status && ACTIVE_STATUSES.has(status)),
    readingResults,
    resultReadError,
    historyError,
    historySaved,
    retryRead,
    retrySave,
    submissionError,
    inputPreparation,
    inputRetryRequest,
    canRetryInputPreparation: inputPreparation?.phase === 'failed' && !submitting,
    retryInputPreparation,
    cancelInputPreparation,
    protocolError,
    pollError: taskQuery.error,
    polling: taskQuery.isFetching,
    generate,
    retry,
    modifyParameters,
    refetch: taskQuery.refetch,
    selectOutput,
    replaceSourceAsset,
  }
}
