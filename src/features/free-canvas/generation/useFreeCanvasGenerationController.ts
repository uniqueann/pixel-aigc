import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushProject } from '@/editor/persistence/projectPersistence'
import { recoveryForTask, usePersistenceStore } from '@/editor/persistence/persistenceStore'
import type { GenerationContext, GenerationRecovery } from '@/editor/persistence/types'
import { createTask, findTaskByRequest } from '@/services/api/task'
import { taskInputKey } from '@/services/api/imageInput'
import { currentWorkstationHistoryOwner, isCurrentWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import { useUserStore } from '@/store/useUserStore'
import { generationIdForTask } from '@/editor/adapters/taskAdapter'
import { ResolveGenerationCommand } from '@/editor/commands'
import { GenerationService } from '@/editor/services/generationService'
import { useEditorStore } from '@/editor/store'
import type {
  Asset,
  GenerationJob,
  GenerationNode,
  ImageAsset,
  ImageNode,
  NodeId,
  SceneId,
  VideoAsset,
  VideoNode,
} from '@/editor/types'
import { useTaskPolling } from '@/hooks/useTaskPolling'
import { useTaskStore } from '@/store/useTaskStore'
import {
  Capability,
  type GenerationTask,
  type ImageToVideoTaskParams,
  type TextToImageTaskParams,
  type TextToVideoTaskParams,
  type VariationTaskParams,
} from '@/types'
import type { CanvasPoint, GenerationPlacement } from '../geometry'
import { calculateDerivedPlacements, calculateGenerationPlacements, calculateNodeBounds, placeArtboardNodes } from '../geometry'
import { canSubmitFreeCanvasTextToImage, canSubmitFreeCanvasVariation, isCanvasMockGateway } from './availability'
import { saveCanvasTaskHistory } from './history'
import type { CanvasGenerationRequest, CanvasGenerationTaskParams } from './requestBuilder'

const ACTIVE_STATUSES = new Set(['pending', 'queued', 'processing'])
const EMPTY_RESULT_ERROR = '任务完成但未返回结果'

type CanvasGenerationTask = GenerationTask<CanvasGenerationTaskParams>
type GeneratedMediaAsset = ImageAsset | VideoAsset

type SubmissionContext = GenerationContext

export interface DerivedGenerationSource {
  node: ImageNode
  asset: ImageAsset
}

function isCanvasGenerationCapability(capability: Capability) {
  return capability === Capability.TextToImage
    || capability === Capability.TextToVideo
    || capability === Capability.Variation
}

function isCanvasGenerationParams(
  value: unknown,
  capability: Capability,
): value is CanvasGenerationTaskParams {
  if (!value || typeof value !== 'object') return false
  const params = value as Partial<
    TextToImageTaskParams & TextToVideoTaskParams & VariationTaskParams & ImageToVideoTaskParams
  >
  const commonValid = typeof params.count === 'number'
    && typeof params.size?.width === 'number'
    && typeof params.size.height === 'number'
  if (!commonValid) return false
  if (capability === Capability.Variation) {
    return (typeof params.sourceImageUrl === 'string' || typeof params.sourceImageKey === 'string')
      && (params.prompt === undefined || typeof params.prompt === 'string')
  }
  if (capability === Capability.TextToVideo) {
    return typeof params.prompt === 'string'
      && typeof params.durationSeconds === 'number'
      && (params.sourceImageUrl === undefined || typeof params.sourceImageUrl === 'string')
  }
  return capability === Capability.TextToImage && typeof params.prompt === 'string'
}

function createGenerationNodes(
  task: CanvasGenerationTask,
  placements: GenerationPlacement[],
  zIndexStart: number,
): GenerationNode[] {
  const generationId = generationIdForTask(task.id)
  return placements.map((placement, index) => ({
    id: `generation-node:${task.id}:${index}`,
    type: 'generation',
    generationId,
    resultIndex: index,
    name: `生成占位 ${index + 1}`,
    ...placement,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: zIndexStart + index,
  }))
}

function mediaAssets(assets: Asset[]) {
  return assets.filter((asset): asset is GeneratedMediaAsset => asset.type === 'image' || asset.type === 'video')
}

function requestForRetry(task: CanvasGenerationTask): CanvasGenerationRequest {
  return {
    capability: task.capability as CanvasGenerationRequest['capability'],
    params: task.params,
    requestId: crypto.randomUUID(),
    modelProfileId: task.modelProfileId ?? recoveryForTask(task.id)?.request.modelProfileId,
  }
}

export function useFreeCanvasGenerationController(sceneId: SceneId | undefined) {
  useUserStore((state) => state.userId)
  const ownerId = currentWorkstationHistoryOwner()
  const mockGateway = isCanvasMockGateway()
  const submissionGateRef = useRef(false)
  const lifetimeAbortRef = useRef(new AbortController())
  const registerAsset = useEditorStore((state) => state.registerAsset)
  const registerGeneration = useEditorStore((state) => state.registerGeneration)
  const addNode = useEditorStore((state) => state.addNode)
  const removeNode = useEditorStore((state) => state.removeNode)
  const executeCommand = useEditorStore((state) => state.executeCommand)
  const selectNodes = useEditorStore((state) => state.selectNodes)
  const project = useEditorStore((state) => state.project)
  const recoveries = usePersistenceStore((state) => state.recoveries)
  const pendingSubmission = Object.values(recoveries).find((record) => record.projectId === project?.id && record.sceneId === sceneId && !record.abandoned && !record.applied && (!record.backendTaskId || (!!record.ownerId && record.ownerId !== ownerId)))
  const epoch = usePersistenceStore((state) => state.epoch)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    lifetimeAbortRef.current = new AbortController()
    return () => { mountedRef.current = false; lifetimeAbortRef.current.abort() }
  }, [])
  const projectId = project?.id
  const isCurrent = useCallback(() => mountedRef.current && isCurrentWorkstationHistoryOwner(ownerId) && useEditorStore.getState().project?.id === projectId && usePersistenceStore.getState().epoch === epoch, [projectId, epoch, ownerId])
  const upsertTask = useTaskStore((state) => state.upsertTask)
  const tasks = useTaskStore((state) => state.tasks)
  const [activeTaskId, setActiveTaskId] = useState<string>()
  const [task, setTask] = useState<CanvasGenerationTask>()
  const [submitting, setSubmitting] = useState(false)
  const [autoRetrying, setAutoRetrying] = useState(false)
  const [submissionError, setSubmissionError] = useState<string>()
  const [preparationPhase, setPreparationPhase] = useState<string>()
  const [historyError, setHistoryError] = useState<string>()
  const [historySaved, setHistorySaved] = useState(false)
  const unsavedHistoryRef = useRef(new Map<string, CanvasGenerationTask>())
  const savingHistoryRef = useRef(new Set<string>())
  const persistHistory = useCallback(async (completedTask: CanvasGenerationTask) => {
    if (mockGateway || ![Capability.Variation, Capability.TextToImage].includes(completedTask.capability) || !isCurrent() || savingHistoryRef.current.has(completedTask.id)) return
    unsavedHistoryRef.current.set(completedTask.id, completedTask)
    savingHistoryRef.current.add(completedTask.id)
    try {
      await saveCanvasTaskHistory(completedTask, ownerId, lifetimeAbortRef.current.signal)
      if (isCurrent()) {
        unsavedHistoryRef.current.delete(completedTask.id)
        setHistorySaved(unsavedHistoryRef.current.size === 0)
        setHistoryError(unsavedHistoryRef.current.size ? '仍有生成图片未保存，可重试保存' : undefined)
      }
    } catch (error) {
      if (isCurrent()) setHistoryError(error instanceof Error ? error.message : '资产保存失败')
    } finally { savingHistoryRef.current.delete(completedTask.id) }
  }, [isCurrent, mockGateway, ownerId])
  const [protocolError, setProtocolError] = useState<string>()
  const resolvedTaskIdsRef = useRef(new Set<string>())
  const handledTaskVersionsRef = useRef(new Set<string>())
  const contextsByTaskIdRef = useRef(new Map<string, SubmissionContext>())
  const retryingTaskIdsRef = useRef(new Set<string>())
  const service = useMemo(
    () => new GenerationService({ registerAsset, registerGeneration }),
    [registerAsset, registerGeneration],
  )

  const restoredGeneration = useMemo(() => {
    const scene = project?.document.scenes.find((item) => item.id === sceneId)
    const placeholder = scene?.nodes.find((node): node is GenerationNode => node.type === 'generation')
    const recoverable = Object.values(recoveries).find((record) => record.projectId === project?.id && record.sceneId === sceneId && record.backendTaskId && !record.applied && !record.abandoned)
    const generation = recoverable?.backendTaskId
      ? project?.generations[generationIdForTask(recoverable.backendTaskId)]
      : placeholder && !recoveryForTask(project?.generations[placeholder.generationId]?.backendTaskId ?? '')?.abandoned ? project?.generations[placeholder.generationId] : undefined
    if (recoverable?.ownerId && recoverable.ownerId !== ownerId) return undefined
    return generation?.backendTaskId
      && isCanvasGenerationCapability(generation.capability)
      && isCanvasGenerationParams(generation.input, generation.capability)
      ? generation
      : undefined
  }, [project, recoveries, sceneId, ownerId])
  const restoredTask = useMemo(() => {
    if (!restoredGeneration?.backendTaskId
      || !isCanvasGenerationParams(restoredGeneration.input, restoredGeneration.capability)) return undefined
    return tasks[restoredGeneration.backendTaskId] as CanvasGenerationTask | undefined
      ?? {
        id: restoredGeneration.backendTaskId,
        capability: restoredGeneration.capability,
        status: restoredGeneration.status,
        params: restoredGeneration.input,
        errorMessage: restoredGeneration.error,
        creditsCost: 0,
        createdAt: restoredGeneration.createdAt,
        updatedAt: restoredGeneration.updatedAt,
      }
  }, [restoredGeneration, tasks])

  const readScene = useCallback(() => {
    if (!sceneId) return undefined
    return useEditorStore.getState().project?.document.scenes.find((scene) => scene.id === sceneId)
  }, [sceneId])

  const placeholdersForTask = useCallback((taskId: string) => {
    const generationId = generationIdForTask(taskId)
    return (readScene()?.nodes ?? [])
      .filter((node): node is GenerationNode => node.type === 'generation' && node.generationId === generationId)
      .sort((a, b) => (a.resultIndex ?? 0) - (b.resultIndex ?? 0))
  }, [readScene])

  const contextForTask = useCallback((taskId: string): SubmissionContext => {
    const cached = contextsByTaskIdRef.current.get(taskId)
    if (cached) return cached
    const persisted = recoveryForTask(taskId)
    if (persisted) return persisted.context
    const generation = useEditorStore.getState().project?.generations[generationIdForTask(taskId)]
    return {
      inputAssetIds: generation?.inputAssetIds ?? [],
      parentGenerationId: generation?.parentGenerationId,
      retryOfGenerationId: generation?.retryOfGenerationId,
      autoRetryRemaining: 0,
      automaticRetry: false,
    }
  }, [])

  const markEmptyResultFailed = useCallback((
    completedTask: CanvasGenerationTask,
    generation: GenerationJob,
  ) => {
    const failedTask: CanvasGenerationTask = {
      ...completedTask,
      status: 'failed',
      errorMessage: EMPTY_RESULT_ERROR,
    }
    setTask(failedTask)
    upsertTask(failedTask)
    registerGeneration({ ...generation, status: 'failed', error: EMPTY_RESULT_ERROR })
    return failedTask
  }, [registerGeneration, upsertTask])

  const resolveTask = useCallback((
    completedTask: CanvasGenerationTask,
    assets: GeneratedMediaAsset[],
    fallbackPlacements: GenerationPlacement[] = [],
    placeholderIds?: NodeId[],
  ) => {
    if (!sceneId || !isCurrent() || recoveryForTask(completedTask.id)?.applied || resolvedTaskIdsRef.current.has(completedTask.id) || assets.length === 0) return
    const placeholders = placeholdersForTask(completedTask.id)
    const currentPlaceholderIds = placeholders.map((node) => node.id)
    const idsToRemove = currentPlaceholderIds.length > 0 ? currentPlaceholderIds : placeholderIds ?? []
    const currentScene = readScene()
    const baseZIndex = Math.max(-1, ...(currentScene?.nodes.map((node) => node.zIndex) ?? [-1])) + 1
    const outputs = assets.map((asset, index) => {
      const image = asset.objectKey ? completedTask.resultImages?.find(item => item.objectKey === asset.objectKey) : undefined
      const ordinal = image?.ordinal ?? index
      const placement = placeholders.find(node => node.resultIndex === ordinal) ?? fallbackPlacements[ordinal] ?? fallbackPlacements[0]
      const width = placement?.width ?? Math.min(320, asset.width || 320)
      const height = placement?.height ?? Math.min(320, asset.height || 320)
      const common = {
        id: `generated-node:${completedTask.id}:${ordinal}`,
        assetId: asset.id,
        name: asset.name,
        x: placement?.x ?? 0,
        y: placement?.y ?? 0,
        width,
        height,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        zIndex: baseZIndex + index,
      }
      const node: ImageNode | VideoNode = asset.type === 'video'
        ? { ...common, type: 'video', duration: asset.duration, startTime: 0 }
        : { ...common, type: 'image' }
      return { asset, node }
    })

    resolvedTaskIdsRef.current.add(completedTask.id)
    executeCommand(new ResolveGenerationCommand(sceneId, idsToRemove, outputs))
    const recovery = recoveryForTask(completedTask.id)
    if (recovery) usePersistenceStore.getState().setRecovery({ ...recovery, applied: true })
    selectNodes([outputs[0].node.id])
    setProtocolError(undefined)
    void persistHistory(completedTask)
  }, [executeCommand, isCurrent, placeholdersForTask, readScene, sceneId, selectNodes, persistHistory])

  const submitRequest = useCallback(async (
    initialRequest: CanvasGenerationRequest,
    initialPlacements: GenerationPlacement[],
    initialReplacedPlaceholders: GenerationNode[] = [],
    initialContext: SubmissionContext = { inputAssetIds: [], autoRetryRemaining: 0, automaticRetry: false },
    confirmedTask?: GenerationTask<CanvasGenerationTaskParams>,
  ) => {
    if (!sceneId || !isCurrent() || !usePersistenceStore.getState().writable || submissionGateRef.current) return
    if (initialRequest.capability === Capability.Variation && !confirmedTask && !canSubmitFreeCanvasVariation()) {
      setSubmissionError('裂变模型尚未就绪，请检查登录与模型配置')
      return
    }
    if (initialRequest.capability === Capability.TextToImage && !confirmedTask && !canSubmitFreeCanvasTextToImage()) {
      setSubmissionError('文生图模型尚未就绪，请检查登录与模型配置')
      return
    }
    submissionGateRef.current = true
    if (!initialContext.automaticRetry) setAutoRetrying(false)
    setSubmitting(true)
    setSubmissionError(undefined)
    setProtocolError(undefined)
    setHistorySaved(false)

    const submitSingle = async (
      request: CanvasGenerationRequest,
      placements: GenerationPlacement[],
      replacedPlaceholders: GenerationNode[],
      context: SubmissionContext,
    ): Promise<void> => {
      context = mockGateway ? context : { ...context, autoRetryRemaining: 0, automaticRetry: false }
      const recovery: GenerationRecovery = {
        projectId: projectId!, sceneId, request, context, placements,
        ...(!mockGateway ? { ownerId } : {}),
        replacedPlaceholderIds: replacedPlaceholders.map((node) => node.id), applied: false,
      }
      usePersistenceStore.getState().setRecovery(recovery)
      await flushProject()
      if (!isCurrent()) return
      const receivedTask = confirmedTask ?? await createTask(request)
      if (!isCurrent()) return
      const adapted = service.reconcile(receivedTask, {
        inputAssetIds: context.inputAssetIds,
        parentGenerationId: context.parentGenerationId,
        retryOfGenerationId: context.retryOfGenerationId,
        outputSize: request.params.size,
        outputDuration: request.capability === Capability.TextToVideo
          ? (request.params as TextToVideoTaskParams).durationSeconds
          : undefined,
      })
      const result = { task: receivedTask, ...adapted }
      usePersistenceStore.getState().setRecovery({ ...recovery, backendTaskId: receivedTask.id })
      await flushProject()
      if (!isCurrent()) return
      let typedTask = result.task as CanvasGenerationTask
      const outputs = mediaAssets(result.assets)
      contextsByTaskIdRef.current.set(typedTask.id, context)
      setTask(typedTask)
      upsertTask(typedTask)
      setActiveTaskId(typedTask.id)
      if (context.automaticRetry && !ACTIVE_STATUSES.has(typedTask.status)) setAutoRetrying(false)

      const emptyResult = typedTask.status === 'succeeded' && outputs.length === 0
      if ((typedTask.status === 'failed' || emptyResult) && context.autoRetryRemaining > 0) {
        usePersistenceStore.getState().setRecovery({ ...recovery, backendTaskId: typedTask.id, context: { ...context, autoRetryRemaining: 0 }, abandoned: true })
        if (emptyResult) typedTask = markEmptyResultFailed(typedTask, result.generation)
        setAutoRetrying(true)
        await submitSingle(
          requestForRetry(typedTask),
          placements,
          replacedPlaceholders,
          {
            ...context,
            retryOfGenerationId: generationIdForTask(typedTask.id),
            autoRetryRemaining: context.autoRetryRemaining - 1,
            automaticRetry: true,
          },
        )
        return
      }

      if (typedTask.status === 'succeeded' && outputs.length > 0) {
        resolveTask(
          typedTask,
          outputs,
          placements,
          replacedPlaceholders.map((node) => node.id),
        )
        return
      }

      if (emptyResult) {
        typedTask = markEmptyResultFailed(typedTask, result.generation)
        setProtocolError(EMPTY_RESULT_ERROR)
      }

      replacedPlaceholders.forEach((node) => removeNode(sceneId, node.id))
      const currentScene = readScene()
      const zIndexStart = Math.max(-1, ...(currentScene?.nodes.map((node) => node.zIndex) ?? [-1])) + 1
      const placeholders = createGenerationNodes(typedTask, placements, zIndexStart)
      placeholders.forEach((node) => addNode(sceneId, node))
      selectNodes(placeholders.length ? [placeholders[0].id] : [])
    }

    try {
      let prepared = initialRequest
      if (!mockGateway && initialRequest.capability === Capability.TextToImage && !confirmedTask && !(initialRequest.params as TextToImageTaskParams).resolution) {
        throw new Error('请选择生成分辨率')
      }
      if (!mockGateway && initialRequest.capability === Capability.Variation && !confirmedTask) {
        const params = { ...initialRequest.params } as VariationTaskParams
        if (!params.sourceImageKey) {
          const source = useEditorStore.getState().project?.assets[initialContext.inputAssetIds[0]]
          if (source?.type !== 'image') throw new Error('源图片不可用，请重新选择图片')
          setPreparationPhase('正在准备并上传原图…')
          params.sourceImageKey = await taskInputKey(source, '读取原图失败', { ownerId, signal: lifetimeAbortRef.current.signal })
          params.sourceWidth = source.width
          params.sourceHeight = source.height
        }
        if (!params.resolution) throw new Error('请选择生成分辨率')
        delete params.sourceImageUrl
        prepared = { ...initialRequest, params }
      }
      if (!isCurrent()) return
      setPreparationPhase('正在提交生成任务…')
      await submitSingle(
        prepared,
        initialPlacements,
        initialReplacedPlaceholders,
        initialContext,
      )
      if (isCurrent()) await flushProject()
    } catch (error) {
      if (isCurrent()) {
        setAutoRetrying(false)
        setSubmissionError(error instanceof Error ? error.message : '生成任务提交失败')
        const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined
        if (typeof status === 'number' && status >= 400 && status < 500 && status !== 408) {
          const record = usePersistenceStore.getState().recoveries[initialRequest.requestId]
          if (record && !record.backendTaskId) usePersistenceStore.getState().setRecovery({ ...record, abandoned: true })
          void flushProject().catch(() => undefined)
        }
      }
    } finally {
      submissionGateRef.current = false
      if (isCurrent()) { setSubmitting(false); setPreparationPhase(undefined) }
    }
  }, [
    addNode,
    isCurrent,
    projectId,
    markEmptyResultFailed,
    readScene,
    removeNode,
    resolveTask,
    sceneId,
    selectNodes,
    service,
    upsertTask,
    mockGateway,
    ownerId,
  ])

  const handlePolledTask = useCallback((nextTask: GenerationTask<unknown>) => {
    if (!isCurrent() || !usePersistenceStore.getState().writable || pendingSubmission || recoveryForTask(nextTask.id)?.abandoned || recoveryForTask(nextTask.id)?.applied) return
    const taskOwner = recoveryForTask(nextTask.id)?.ownerId
    if (taskOwner && taskOwner !== ownerId) return
    if (!isCanvasGenerationCapability(nextTask.capability)
      || !isCanvasGenerationParams(nextTask.params, nextTask.capability)) return
    const version = `${nextTask.id}:${nextTask.status}:${nextTask.updatedAt}`
    if (handledTaskVersionsRef.current.has(version)) return
    handledTaskVersionsRef.current.add(version)
    let typedTask = nextTask as CanvasGenerationTask
    const originalContext = contextForTask(typedTask.id)
    const context = mockGateway ? originalContext : { ...originalContext, autoRetryRemaining: 0, automaticRetry: false }
    const adapted = service.reconcile(typedTask, {
      inputAssetIds: context.inputAssetIds,
      parentGenerationId: context.parentGenerationId,
      retryOfGenerationId: context.retryOfGenerationId,
      outputSize: typedTask.params.size,
      outputDuration: typedTask.capability === Capability.TextToVideo
        ? (typedTask.params as TextToVideoTaskParams).durationSeconds
        : undefined,
    })
    const outputs = mediaAssets(adapted.assets)
    const emptyResult = typedTask.status === 'succeeded' && outputs.length === 0
    if (context.automaticRetry && !ACTIVE_STATUSES.has(typedTask.status)) setAutoRetrying(false)
    setTask(typedTask)
    upsertTask(typedTask)

    if ((typedTask.status === 'failed' || emptyResult)
      && context.autoRetryRemaining > 0
      && !retryingTaskIdsRef.current.has(typedTask.id)) {
      if (emptyResult) typedTask = markEmptyResultFailed(typedTask, adapted.generation)
      const previous = recoveryForTask(typedTask.id)
      if (previous) usePersistenceStore.getState().setRecovery({ ...previous, context: { ...context, autoRetryRemaining: 0 }, abandoned: true })
      retryingTaskIdsRef.current.add(typedTask.id)
      setAutoRetrying(true)
      const placeholders = placeholdersForTask(typedTask.id)
      const placements = placeholders.map(({ x, y, width, height }) => ({ x, y, width, height }))
      void submitRequest(
        requestForRetry(typedTask),
        placements,
        placeholders,
        {
          ...context,
          retryOfGenerationId: generationIdForTask(typedTask.id),
          autoRetryRemaining: context.autoRetryRemaining - 1,
          automaticRetry: true,
        },
      ).finally(() => retryingTaskIdsRef.current.delete(typedTask.id))
      return
    }

    if (typedTask.status === 'succeeded' && outputs.length > 0) {
      const recovery = recoveryForTask(typedTask.id)
      resolveTask(
        typedTask,
        outputs,
        recovery?.placements,
        recovery?.replacedPlaceholderIds,
      )
      void flushProject().catch(() => undefined)
      return
    }
    if (emptyResult) {
      markEmptyResultFailed(typedTask, adapted.generation)
      setProtocolError(EMPTY_RESULT_ERROR)
    }
    void flushProject().catch(() => undefined)
  }, [
    contextForTask,
    isCurrent,
    pendingSubmission,
    markEmptyResultFailed,
    placeholdersForTask,
    resolveTask,
    service,
    submitRequest,
    mockGateway,
    ownerId,
    upsertTask,
  ])

  const displayedTask = task ?? restoredTask
  const needsQuery = displayedTask && (ACTIVE_STATUSES.has(displayedTask.status) || (displayedTask.status === 'succeeded' && !recoveryForTask(displayedTask.id)?.applied))
  const queryTaskId = activeTaskId ?? restoredGeneration?.backendTaskId
  const taskQuery = useTaskPolling(queryTaskId, handlePolledTask, !pendingSubmission && !!needsQuery)
  const restoredAutomaticRetry = mockGateway && displayedTask ? recoveryForTask(displayedTask.id)?.context.automaticRetry && ACTIVE_STATUSES.has(displayedTask.status) : false

  const generate = useCallback(async (request: CanvasGenerationRequest, center: CanvasPoint) => {
    const scene = readScene()
    const preferred = calculateGenerationPlacements(center, request.params.size, request.params.count)
    const placements = scene
      ? placeArtboardNodes(
        preferred,
        scene.nodes.map(node => calculateNodeBounds(node)),
        { width: scene.width, height: scene.height },
      )
      : preferred
    await submitRequest(request, placements)
    return placements
  }, [readScene, submitRequest])

  const generateDerived = useCallback(async (
    request: CanvasGenerationRequest,
    source: DerivedGenerationSource,
  ) => {
    const state = useEditorStore.getState()
    const latestNode = readScene()?.nodes.find((node): node is ImageNode => (
      node.id === source.node.id && node.type === 'image'
    ))
    const sourceNode = latestNode ?? source.node
    const origin = source.asset.generationId
      ? state.project?.generations[source.asset.generationId]
      : Object.values(state.project?.generations ?? {})
        .find((generation) => generation.outputAssetIds.includes(source.asset.id))
    const scene = readScene()
    const placements = calculateDerivedPlacements(sourceNode, request.params.count, {
      scene: scene ? { width: scene.width, height: scene.height } : undefined,
      occupied: (scene?.nodes ?? [])
        .filter(node => node.id !== sourceNode.id)
        .map(node => calculateNodeBounds(node)),
    })
    await submitRequest(request, placements, [], {
      inputAssetIds: [source.asset.id],
      parentGenerationId: origin?.id,
      autoRetryRemaining: mockGateway ? 1 : 0,
      automaticRetry: false,
    })
    return placements
  }, [readScene, submitRequest, mockGateway])

  const retry = useCallback(async () => {
    if (submitting || pendingSubmission || !displayedTask || !isCanvasGenerationCapability(displayedTask.capability)) return
    const placeholders = placeholdersForTask(displayedTask.id)
    const placements = placeholders.map(({ x, y, width, height }) => ({ x, y, width, height }))
    const previousContext = contextForTask(displayedTask.id)
    const derived = previousContext.inputAssetIds.length > 0
    const previous = recoveryForTask(displayedTask.id)
    if (previous) usePersistenceStore.getState().setRecovery({ ...previous, abandoned: true })
    const request = requestForRetry(displayedTask)
    const source = useEditorStore.getState().project?.assets[previousContext.inputAssetIds[0]]
    if (!mockGateway && request.capability === Capability.Variation && source?.type === 'image') {
      // 手动重试是新任务，本地原图重新准备临时输入，避免复用已过期的上传对象。
      const params = { ...request.params } as VariationTaskParams
      delete params.sourceImageKey
      request.params = params
    }
    await submitRequest(
      request,
      placements,
      placeholders,
      {
        ...previousContext,
        retryOfGenerationId: generationIdForTask(displayedTask.id),
        autoRetryRemaining: derived && mockGateway ? 1 : 0,
        automaticRetry: false,
      },
    )
  }, [contextForTask, displayedTask, pendingSubmission, placeholdersForTask, submitRequest, submitting, mockGateway])

  const modifyParameters = useCallback(() => {
    if (submitting || pendingSubmission) return
    if (displayedTask && sceneId) {
      const previous = recoveryForTask(displayedTask.id)
      if (previous) usePersistenceStore.getState().setRecovery({ ...previous, abandoned: true })
      placeholdersForTask(displayedTask.id).forEach((node) => removeNode(sceneId, node.id))
    }
    setTask(undefined)
    setActiveTaskId(undefined)
    setSubmissionError(undefined)
    setProtocolError(undefined)
    setAutoRetrying(false)
    selectNodes([])
  }, [displayedTask, pendingSubmission, placeholdersForTask, removeNode, sceneId, selectNodes, submitting])

  const dismissTask = useCallback(() => {
    if (autoRetrying || (displayedTask?.status && ACTIVE_STATUSES.has(displayedTask.status))) return
    setTask(undefined)
    setActiveTaskId(undefined)
    setSubmissionError(undefined)
    setProtocolError(undefined)
  }, [autoRetrying, displayedTask])

  const resumeSubmission = useCallback(async () => {
    if (!pendingSubmission || submissionGateRef.current) return
    if (pendingSubmission.ownerId && pendingSubmission.ownerId !== ownerId) {
      setSubmissionError('此请求属于其他账号，请放弃等待后重新创建任务')
      return
    }
    const placeholders = (readScene()?.nodes ?? []).filter((node): node is GenerationNode => node.type === 'generation' && pendingSubmission.replacedPlaceholderIds.includes(node.id))
    let confirmed: GenerationTask<CanvasGenerationTaskParams> | undefined
    if (!mockGateway) {
      submissionGateRef.current = true
      setSubmitting(true)
      try { confirmed = await findTaskByRequest(pendingSubmission.request.requestId) as GenerationTask<CanvasGenerationTaskParams> | undefined }
      catch (error) {
        if (isCurrent()) setSubmissionError(error instanceof Error ? error.message : '原任务查询失败，请重新查询')
        return
      } finally {
        submissionGateRef.current = false
        if (isCurrent()) setSubmitting(false)
      }
    }
    await submitRequest(pendingSubmission.request, pendingSubmission.placements, placeholders, pendingSubmission.context, confirmed)
  }, [pendingSubmission, readScene, submitRequest, mockGateway, ownerId, isCurrent])

  const abandonSubmission = useCallback(() => {
    if (!pendingSubmission || submitting) return
    usePersistenceStore.getState().setRecovery({ ...pendingSubmission, abandoned: true })
    pendingSubmission.replacedPlaceholderIds.forEach((id) => { if (sceneId) removeNode(sceneId, id) })
    if (pendingSubmission.backendTaskId && sceneId) placeholdersForTask(pendingSubmission.backendTaskId).forEach(node => removeNode(sceneId, node.id))
    setTask(undefined)
    setActiveTaskId(undefined)
    setSubmissionError(undefined)
    selectNodes([])
    void flushProject().catch(() => undefined)
  }, [pendingSubmission, placeholdersForTask, removeNode, sceneId, selectNodes, submitting])

  const status = displayedTask?.status
  const active = autoRetrying || (!!status && ACTIVE_STATUSES.has(status))
  return {
    task: displayedTask,
    submitting,
    autoRetrying: autoRetrying || !!restoredAutomaticRetry,
    pendingSubmission,
    resumeSubmission,
    abandonSubmission,
    active,
    formLocked: submitting || !!pendingSubmission || active || status === 'failed' || status === 'cancelled',
    submissionError,
    preparationPhase,
    historyError,
    historySaved,
    retryHistory: () => { void Promise.all([...unsavedHistoryRef.current.values()].map(persistHistory)) },
    protocolError,
    pollError: taskQuery.error,
    polling: taskQuery.isFetching,
    generate,
    generateDerived,
    retry,
    modifyParameters,
    dismissTask,
    refetch: taskQuery.refetch,
  }
}
