import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTaskPolling } from '@/hooks/useTaskPolling'
import { renderScaledSource } from '@/pages/Toolbox/aspect-ratio/outpaintClient'
import { requestErase } from '@/services/api/erase'
import { paddingAround, requestOutpaint } from '@/services/api/outpaint'
import { requestRepaint } from '@/services/api/repaint'
import { cloudEnabled } from '@/cloud/client'
import { liveCapabilityReady } from '@/services/api/task'
import { uploadDataUrl, uploadTaskInput } from '@/services/api/upload'
import { GenerationService } from '@/editor/services/generationService'
import { useEditorStore } from '@/editor/store'
import type { AssetId, GenerationId, ImageAsset } from '@/editor/types'
import type { TaskAdapterOptions } from '@/editor/adapters/taskAdapter'
import { useTaskStore } from '@/store/useTaskStore'
import { Capability, type GenerationTask, type ImageEditTaskParams, type InpaintTaskParams, type OutpaintTaskParams, type TaskStatus } from '@/types'
import { recordWorkstationHistory } from '@/features/assets/workstationHistory'
import { fusionHistoryText, readReferenceImageKey } from '@shared/fusion'
import { readRelight, relightHistoryText, type RelightOptions } from '@shared/relight'
import { readRetouchDirections, retouchHistoryText } from '@shared/retouch'
import { blobFromImageSource } from '../download'
import { remapMaskExportError } from '@/pages/ImageWorkstation/utils/maskExport'
import { isVisuallySameImage, SOURCE_ECHO_ERROR } from '../sourceEcho'
import { finalizeWorkstationResults } from '../results'
import { COMING_SOON_SUBMIT_MESSAGE, isWorkstationToolReady } from '../tools/registry'
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
}

const ACTIVE_STATUSES = new Set<TaskStatus>(['pending', 'queued', 'processing'])
const useMockGateway = import.meta.env.VITE_GENERATION_MODE === 'mock' && !cloudEnabled

function isInlineUrl(url?: string) {
  return !!url && (url.startsWith('data:') || url.startsWith('blob:'))
}

async function prepareImageEditRequest(
  request: WorkstationGenerationRequest,
  sourceAsset: ImageAsset,
  referenceAsset?: ImageAsset,
): Promise<WorkstationGenerationRequest> {
  const uploadsSource = request.capability === Capability.ImageEdit || request.capability === Capability.Variation
  if (!uploadsSource || useMockGateway) return request
  const params = { ...(request.params as ImageEditTaskParams) }
  if (!params.sourceImageKey) {
    const response = await fetch(sourceAsset.url)
    if (!response.ok) throw new Error('读取原图失败')
    params.sourceImageKey = await uploadTaskInput(await response.blob(), sourceAsset.mimeType)
  }
  params.sourceWidth = sourceAsset.width
  params.sourceHeight = sourceAsset.height
  if (isInlineUrl(params.sourceImageUrl)) delete params.sourceImageUrl
  if (referenceAsset && !params.referenceImageKey) {
    const response = await fetch(referenceAsset.url)
    if (!response.ok) throw new Error('读取场景图失败')
    params.referenceImageKey = await uploadTaskInput(await response.blob(), referenceAsset.mimeType)
  }
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
    ? projectAsset
    : initialAsset?.id === inputAssetId ? initialAsset : undefined
  const outputAssets = outputAssetIds.flatMap((assetId) => {
    const asset = project?.assets[assetId]
    return asset?.type === 'image' ? [asset] : []
  })

  const persistHistory = useCallback((
    completedTask: GenerationTask<unknown>,
    assets: ImageAsset[],
  ) => {
    const retouchDirections = readRetouchDirections(completedTask.params)
    const referenceKey = readReferenceImageKey(completedTask.params)
    const relight = readRelight(completedTask.params)
    const toolSlug = referenceKey
      ? 'fusion'
      : relight
        ? 'relight'
        : retouchDirections.length
          ? 'retouch'
          : completedTask.capability === Capability.Inpaint
            ? ((completedTask.params as InpaintTaskParams).mode === 'repaint' ? 'repaint' : 'remove')
            : completedTask.capability === Capability.Outpaint
              ? 'outpaint'
              : activeTool.slug
    const note = typeof (completedTask.params as { prompt?: unknown })?.prompt === 'string'
      ? (completedTask.params as { prompt?: string }).prompt
      : undefined
    const prompt = referenceKey
      ? fusionHistoryText(note)
      : relight
        ? relightHistoryText(relight, note)
        : retouchDirections.length
          ? retouchHistoryText(retouchDirections, note)
          : note
    void Promise.all(assets.map(async (asset, index) => {
      const objectKey = asset.objectKey ?? completedTask.resultImages?.[index]?.objectKey
      const result = await blobFromImageSource(asset.url, objectKey)
      await recordWorkstationHistory({
        id: `${completedTask.id}:${index}`,
        toolSlug,
        capability: completedTask.capability,
        prompt,
        width: asset.width,
        height: asset.height,
        mimeType: asset.mimeType || result.type || 'image/jpeg',
        result,
        createdAt: completedTask.createdAt,
        updatedAt: completedTask.updatedAt,
      })
    })).catch(() => undefined)
  }, [activeTool.slug])

  const applyCompletedTask = useCallback((
    completedTask: GenerationTask<unknown>,
    assets: ImageAsset[],
  ) => {
    if (completedTask.status !== 'succeeded') return
    const finalized = finalizeWorkstationResults(completedTask, assets)
    if (finalized.error) {
      setProtocolError(finalized.error)
      return
    }
    setOutputAssetIds(finalized.assets.map((asset) => asset.id))
    setInputAssetId(finalized.assets[0].id)
    setProtocolError(undefined)
    persistHistory(completedTask, finalized.assets)
  }, [persistHistory])

  const handlePolledTask = useCallback((nextTask: GenerationTask<unknown>) => {
    const context = submissionsRef.current.get(nextTask.id)
    if (!context) return
    const version = `${nextTask.id}:${nextTask.status}:${nextTask.updatedAt}`
    if (handledTaskVersionsRef.current.has(version)) return
    handledTaskVersionsRef.current.add(version)
    setTask(nextTask)
    const adapted = service.reconcile(nextTask, context.options)
    applyCompletedTask(
      nextTask,
      adapted.assets.filter((asset): asset is ImageAsset => asset.type === 'image'),
    )
  }, [applyCompletedTask, service])

  const taskQuery = useTaskPolling(activeTaskId, handlePolledTask)

  const completeRepaint = useCallback(async (
    sourceAsset: ImageAsset,
    promptText: string,
    maskDataUrl: string,
    parentGenerationId: GenerationId | undefined,
  ) => {
    setSubmitting(true)
    setSubmissionError(undefined)
    setProtocolError(undefined)
    try {
      const response = await fetch(sourceAsset.url)
      if (!response.ok) throw new Error('读取原图失败')
      const original = await response.blob()
      const result = await requestRepaint(original, maskDataUrl, promptText)
      const now = new Date().toISOString()
      const completed: GenerationTask<InpaintTaskParams> = {
        id: crypto.randomUUID(),
        capability: Capability.Inpaint,
        status: 'succeeded',
        params: { sourceImageUrl: sourceAsset.url, maskUrl: maskDataUrl, mode: 'repaint', prompt: promptText },
        resultUrls: [URL.createObjectURL(result)],
        creditsCost: 0,
        createdAt: now,
        updatedAt: now,
      }
      const outputSize = { width: sourceAsset.width, height: sourceAsset.height }
      const options: SubmissionContext['options'] = {
        inputAssetIds: [sourceAsset.id],
        parentGenerationId,
        outputSize,
      }
      submissionsRef.current.set(completed.id, {
        request: { capability: Capability.Inpaint, params: completed.params, outputSize },
        options,
      })
      setTask(completed)
      upsertTask(completed)
      setActiveTaskId(undefined)
      if (await isVisuallySameImage(original, result)) {
        setProtocolError(SOURCE_ECHO_ERROR)
        return completed
      }
      const adapted = service.reconcile(completed, options)
      applyCompletedTask(completed, adapted.assets.filter((asset): asset is ImageAsset => asset.type === 'image'))
      return completed
    } catch (error) {
      const message = error instanceof Error ? error.message : '重绘失败'
      setSubmissionError(message)
      throw error
    } finally {
      setSubmitting(false)
    }
  }, [applyCompletedTask, service, upsertTask])

  const completeOutpaint = useCallback(async (
    sourceAsset: ImageAsset,
    targetSize: { width: number; height: number },
    originOffset: { x: number; y: number },
    sourceSize: { width: number; height: number },
    parentGenerationId: GenerationId | undefined,
  ) => {
    setSubmitting(true)
    setSubmissionError(undefined)
    setProtocolError(undefined)
    try {
      const padding = paddingAround(sourceSize.width, sourceSize.height, originOffset.x, originOffset.y, targetSize.width, targetSize.height)
      const response = await fetch(sourceAsset.url)
      if (!response.ok) throw new Error('读取原图失败')
      const original = await response.blob()
      const needsScale = sourceSize.width !== sourceAsset.width || sourceSize.height !== sourceAsset.height
      const input = needsScale
        ? await renderScaledSource(new File([original], sourceAsset.name || 'source.jpg', { type: original.type || 'image/jpeg' }), sourceSize.width, sourceSize.height)
        : original
      const hasPad = padding.left + padding.right + padding.top + padding.bottom > 0
      const result = hasPad ? await requestOutpaint(input, 'image/jpeg', padding) : input
      const now = new Date().toISOString()
      const completed: GenerationTask<OutpaintTaskParams> = {
        id: crypto.randomUUID(),
        capability: Capability.Outpaint,
        status: 'succeeded',
        params: { sourceImageUrl: sourceAsset.url, targetSize, originOffset, sourceSize },
        resultUrls: [URL.createObjectURL(result)],
        creditsCost: 0,
        createdAt: now,
        updatedAt: now,
      }
      const options: SubmissionContext['options'] = {
        inputAssetIds: [sourceAsset.id],
        parentGenerationId,
        outputSize: targetSize,
      }
      submissionsRef.current.set(completed.id, {
        request: { capability: Capability.Outpaint, params: completed.params, outputSize: targetSize },
        options,
      })
      setTask(completed)
      upsertTask(completed)
      setActiveTaskId(undefined)
      if (hasPad && await isVisuallySameImage(input, result)) {
        setProtocolError(SOURCE_ECHO_ERROR)
        return completed
      }
      const adapted = service.reconcile(completed, options)
      applyCompletedTask(completed, adapted.assets.filter((asset): asset is ImageAsset => asset.type === 'image'))
      return completed
    } catch (error) {
      const message = error instanceof Error ? error.message : '扩图失败'
      setSubmissionError(message)
      throw error
    } finally {
      setSubmitting(false)
    }
  }, [applyCompletedTask, service, upsertTask])

  const completeErase = useCallback(async (
    sourceAsset: ImageAsset,
    maskDataUrl: string,
    prompt: string,
    parentGenerationId: GenerationId | undefined,
  ) => {
    setSubmitting(true)
    setSubmissionError(undefined)
    setProtocolError(undefined)
    try {
      const response = await fetch(sourceAsset.url)
      if (!response.ok) throw new Error('读取原图失败')
      const original = await response.blob()
      const result = await requestErase(original, original.type || 'image/jpeg', maskDataUrl, prompt)
      const now = new Date().toISOString()
      const outputSize = { width: sourceAsset.width, height: sourceAsset.height }
      const completed: GenerationTask<InpaintTaskParams> = {
        id: crypto.randomUUID(),
        capability: Capability.Inpaint,
        status: 'succeeded',
        params: {
          sourceImageUrl: sourceAsset.url,
          maskUrl: maskDataUrl,
          mode: 'remove',
          prompt: prompt || undefined,
        },
        resultUrls: [URL.createObjectURL(result)],
        creditsCost: 0,
        createdAt: now,
        updatedAt: now,
      }
      const options: SubmissionContext['options'] = {
        inputAssetIds: [sourceAsset.id],
        parentGenerationId,
        outputSize,
      }
      submissionsRef.current.set(completed.id, {
        request: { capability: Capability.Inpaint, params: completed.params, outputSize },
        options,
      })
      setTask(completed)
      upsertTask(completed)
      setActiveTaskId(undefined)
      if (await isVisuallySameImage(original, result)) {
        setProtocolError(SOURCE_ECHO_ERROR)
        return completed
      }
      const adapted = service.reconcile(completed, options)
      applyCompletedTask(completed, adapted.assets.filter((asset): asset is ImageAsset => asset.type === 'image'))
      return completed
    } catch (error) {
      const message = error instanceof Error ? error.message : '消除失败'
      setSubmissionError(message)
      throw error
    } finally {
      setSubmitting(false)
    }
  }, [applyCompletedTask, service, upsertTask])

  const submitRequest = useCallback(async (
    request: WorkstationGenerationRequest,
    sourceAsset: ImageAsset,
    parentGenerationId: GenerationId | undefined,
  ) => {
    setSubmitting(true)
    setSubmissionError(undefined)
    setProtocolError(undefined)
    const options: SubmissionContext['options'] = {
      inputAssetIds: [sourceAsset.id],
      parentGenerationId,
      outputSize: request.outputSize,
    }
    try {
      const prepared = await prepareImageEditRequest(request, sourceAsset, referenceAsset)
      const result = await service.submit({
        capability: prepared.capability,
        requestId: crypto.randomUUID(),
        params: prepared.params,
        modelProfileId: prepared.modelProfileId ?? modelProfileId,
      }, options)
      submissionsRef.current.set(result.task.id, { request: prepared, options })
      setTask(result.task as GenerationTask<unknown>)
      upsertTask(result.task as GenerationTask<unknown>)
      setActiveTaskId(result.task.id)
      applyCompletedTask(
        result.task as GenerationTask<unknown>,
        result.assets.filter((asset): asset is ImageAsset => asset.type === 'image'),
      )
      return result.task
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成任务提交失败'
      setSubmissionError(message)
      throw error
    } finally {
      setSubmitting(false)
    }
  }, [applyCompletedTask, modelProfileId, referenceAsset, service, upsertTask])

  const generate = useCallback(async (canvasHandle: WorkstationCanvasHandle | null) => {
    if (!isWorkstationToolReady(activeTool, capabilityReady)) throw new Error(COMING_SOON_SUBMIT_MESSAGE)
    const product = useProductAsset ? productAsset : inputAsset
    if (activeTool.slug === 'fusion' && (!product || !referenceAsset?.url)) {
      throw new Error('请先上传商品图和场景图')
    }
    if (!product) throw new Error('请先上传需要编辑的图片')
    registerAsset(product)
    if (referenceAsset) registerAsset(referenceAsset)
    const initialContext = {
      sourceAsset: product,
      referenceAsset,
      prompt,
      count,
      resolution,
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
      canvasContext = {
        maskUrl,
        targetSize: canvasHandle.getTargetSize?.(),
        originOffset: canvasHandle.getOriginOffset?.(),
      }
    }

    const request = activeTool.buildRequest({ ...initialContext, ...canvasContext })
    return submitRequest({ ...request, modelProfileId }, product, product.generationId)
  }, [activeTool, capabilityReady, completeErase, completeOutpaint, completeRepaint, count, inputAsset, modelProfileId, productAsset, prompt, referenceAsset, registerAsset, relight, resolution, retouchDirections, submitRequest, useProductAsset])

  const retry = useCallback(async () => {
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
    return submitRequest(context.request, sourceAsset, context.options.parentGenerationId)
  }, [capabilityReady, completeErase, completeOutpaint, completeRepaint, submitRequest, task])

  const modifyParameters = useCallback(() => {
    setTask(undefined)
    setActiveTaskId(undefined)
    setSubmissionError(undefined)
    setProtocolError(undefined)
  }, [])

  const replaceSourceAsset = useCallback((asset: ImageAsset) => {
    if (!useEditorStore.getState().project) createProject('图片工作台', { width: asset.width, height: asset.height })
    registerAsset(asset)
    setInputAssetId(asset.id)
    setOutputAssetIds([])
    setTask(undefined)
    setActiveTaskId(undefined)
    setSubmissionError(undefined)
    setProtocolError(undefined)
  }, [createProject, registerAsset])

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
    formLocked: !!status && ACTIVE_STATUSES.has(status),
    submissionError,
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
