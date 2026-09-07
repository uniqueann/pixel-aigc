import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTaskPolling } from '@/hooks/useTaskPolling'
import { uploadDataUrl } from '@/services/api/upload'
import { GenerationService } from '@/editor/services/generationService'
import { useEditorStore } from '@/editor/store'
import type { AssetId, GenerationId, ImageAsset } from '@/editor/types'
import type { TaskAdapterOptions } from '@/editor/adapters/taskAdapter'
import { useTaskStore } from '@/store/useTaskStore'
import type { GenerationTask, TaskStatus } from '@/types'
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
  resolution?: '2k' | '4k'
}

interface SubmissionContext {
  request: WorkstationGenerationRequest
  options: TaskAdapterOptions & { inputAssetIds: AssetId[] }
}

const ACTIVE_STATUSES = new Set<TaskStatus>(['pending', 'queued', 'processing'])

export function useImageWorkstationController({
  activeTool,
  initialAsset,
  prompt,
  count,
  resolution,
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

  const applyCompletedTask = useCallback((
    completedTask: GenerationTask<unknown>,
    assets: ImageAsset[],
  ) => {
    if (completedTask.status !== 'succeeded') return
    if (assets.length === 0) {
      setProtocolError('任务已完成，但接口没有返回图片结果')
      return
    }
    setOutputAssetIds(assets.map((asset) => asset.id))
    setInputAssetId(assets[0].id)
    setProtocolError(undefined)
  }, [])

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
      const result = await service.submit({
        capability: request.capability,
        requestId: crypto.randomUUID(),
        params: request.params,
      }, options)
      submissionsRef.current.set(result.task.id, { request, options })
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
  }, [applyCompletedTask, service, upsertTask])

  const generate = useCallback(async (canvasHandle: WorkstationCanvasHandle | null) => {
    if (!inputAsset) throw new Error('请先上传需要编辑的图片')
    const initialContext = { sourceAsset: inputAsset, prompt, count, resolution }
    const validation = activeTool.validate?.(initialContext)
    if (validation && !validation.valid) throw new Error(validation.message ?? '当前参数不完整')

    let canvasContext = {}
    if (activeTool.interactionMode !== 'params-only') {
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
    return submitRequest(request, inputAsset, inputAsset.generationId)
  }, [activeTool, count, inputAsset, prompt, resolution, submitRequest])

  const retry = useCallback(async () => {
    if (!task) return
    const context = submissionsRef.current.get(task.id)
    const sourceAssetId = context?.options.inputAssetIds[0]
    const sourceAsset = sourceAssetId
      ? useEditorStore.getState().project?.assets[sourceAssetId]
      : undefined
    if (!context || sourceAsset?.type !== 'image') return
    return submitRequest(context.request, sourceAsset, context.options.parentGenerationId)
  }, [submitRequest, task])

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
