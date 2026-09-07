import { useCallback, useMemo, useRef, useState } from 'react'
import { ResolveGenerationCommand } from '@/editor/commands'
import { generationIdForTask } from '@/editor/adapters/taskAdapter'
import { GenerationService } from '@/editor/services/generationService'
import { useEditorStore } from '@/editor/store'
import type {
  GenerationNode,
  ImageAsset,
  ImageNode,
  NodeId,
  SceneId,
} from '@/editor/types'
import { useTaskPolling } from '@/hooks/useTaskPolling'
import { useTaskStore } from '@/store/useTaskStore'
import { Capability, type GenerationTask, type TextToImageTaskParams } from '@/types'
import type { CanvasPoint, GenerationPlacement } from '../geometry'
import { calculateGenerationPlacements } from '../geometry'
import type { ImageSizePreset } from './config'
import { buildTextToImageRequest } from './requestBuilder'

const ACTIVE_STATUSES = new Set(['pending', 'queued', 'processing'])

function isTextToImageParams(value: unknown): value is TextToImageTaskParams {
  if (!value || typeof value !== 'object') return false
  const params = value as Partial<TextToImageTaskParams>
  return typeof params.prompt === 'string'
    && typeof params.count === 'number'
    && typeof params.size?.width === 'number'
    && typeof params.size.height === 'number'
}

function createGenerationNodes(
  task: GenerationTask<TextToImageTaskParams>,
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

export function useFreeCanvasGenerationController(sceneId: SceneId | undefined) {
  const registerAsset = useEditorStore((state) => state.registerAsset)
  const registerGeneration = useEditorStore((state) => state.registerGeneration)
  const addNode = useEditorStore((state) => state.addNode)
  const removeNode = useEditorStore((state) => state.removeNode)
  const executeCommand = useEditorStore((state) => state.executeCommand)
  const selectNodes = useEditorStore((state) => state.selectNodes)
  const project = useEditorStore((state) => state.project)
  const upsertTask = useTaskStore((state) => state.upsertTask)
  const tasks = useTaskStore((state) => state.tasks)
  const [activeTaskId, setActiveTaskId] = useState<string>()
  const [task, setTask] = useState<GenerationTask<TextToImageTaskParams>>()
  const [submitting, setSubmitting] = useState(false)
  const [submissionError, setSubmissionError] = useState<string>()
  const [protocolError, setProtocolError] = useState<string>()
  const resolvedTaskIdsRef = useRef(new Set<string>())
  const handledTaskVersionsRef = useRef(new Set<string>())
  const service = useMemo(
    () => new GenerationService({ registerAsset, registerGeneration }),
    [registerAsset, registerGeneration],
  )

  const restoredGeneration = useMemo(() => {
    const scene = project?.document.scenes.find((item) => item.id === sceneId)
    const placeholder = scene?.nodes.find((node): node is GenerationNode => node.type === 'generation')
    const generation = placeholder ? project?.generations[placeholder.generationId] : undefined
    return generation?.backendTaskId && isTextToImageParams(generation.input) ? generation : undefined
  }, [project, sceneId])
  const restoredTask = useMemo(() => {
    if (!restoredGeneration?.backendTaskId || !isTextToImageParams(restoredGeneration.input)) return undefined
    return tasks[restoredGeneration.backendTaskId] as GenerationTask<TextToImageTaskParams> | undefined
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

  const resolveTask = useCallback((
    completedTask: GenerationTask<TextToImageTaskParams>,
    assets: ImageAsset[],
    fallbackPlacements: GenerationPlacement[] = [],
    placeholderIds?: NodeId[],
  ) => {
    if (!sceneId || resolvedTaskIdsRef.current.has(completedTask.id)) return
    const placeholders = placeholdersForTask(completedTask.id)
    const idsToRemove = placeholderIds ?? placeholders.map((node) => node.id)
    if (assets.length === 0) {
      idsToRemove.forEach((nodeId) => removeNode(sceneId, nodeId))
      resolvedTaskIdsRef.current.add(completedTask.id)
      setProtocolError('任务已完成，但接口没有返回图片结果')
      return
    }

    const currentScene = readScene()
    const baseZIndex = Math.max(-1, ...(currentScene?.nodes.map((node) => node.zIndex) ?? [-1])) + 1
    const outputs = assets.map((asset, index) => {
      const placement = placeholders[index] ?? fallbackPlacements[index] ?? fallbackPlacements[0]
      const width = placement?.width ?? Math.min(320, asset.width || 320)
      const height = placement?.height ?? Math.min(320, asset.height || 320)
      const node: ImageNode = {
        id: `generated-node:${completedTask.id}:${index}`,
        type: 'image',
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
      return { asset, node }
    })

    resolvedTaskIdsRef.current.add(completedTask.id)
    executeCommand(new ResolveGenerationCommand(sceneId, idsToRemove, outputs))
    selectNodes([outputs[0].node.id])
    setProtocolError(undefined)
  }, [executeCommand, placeholdersForTask, readScene, removeNode, sceneId, selectNodes])

  const handlePolledTask = useCallback((nextTask: GenerationTask<unknown>) => {
    if (!isTextToImageParams(nextTask.params)) return
    const version = `${nextTask.id}:${nextTask.status}:${nextTask.updatedAt}`
    if (handledTaskVersionsRef.current.has(version)) return
    handledTaskVersionsRef.current.add(version)
    const typedTask = nextTask as GenerationTask<TextToImageTaskParams>
    setTask(typedTask)
    const adapted = service.reconcile(typedTask, { inputAssetIds: [], outputSize: typedTask.params.size })
    if (typedTask.status === 'succeeded') {
      resolveTask(typedTask, adapted.assets.filter((asset): asset is ImageAsset => asset.type === 'image'))
    }
  }, [resolveTask, service])

  const taskQuery = useTaskPolling(activeTaskId ?? restoredGeneration?.backendTaskId, handlePolledTask)
  const displayedTask = task ?? restoredTask

  const submitParams = useCallback(async (
    params: TextToImageTaskParams,
    placements: GenerationPlacement[],
    replacedPlaceholders: GenerationNode[] = [],
  ) => {
    if (!sceneId) return
    setSubmitting(true)
    setSubmissionError(undefined)
    setProtocolError(undefined)
    try {
      const result = await service.submit({
        capability: Capability.TextToImage,
        params,
        requestId: crypto.randomUUID(),
      }, {
        inputAssetIds: [],
        outputSize: params.size,
      })
      const typedTask = result.task as GenerationTask<TextToImageTaskParams>
      setTask(typedTask)
      upsertTask(typedTask)
      setActiveTaskId(typedTask.id)

      if (typedTask.status === 'succeeded') {
        resolveTask(
          typedTask,
          result.assets.filter((asset): asset is ImageAsset => asset.type === 'image'),
          placements,
          replacedPlaceholders.map((node) => node.id),
        )
        return
      }

      replacedPlaceholders.forEach((node) => removeNode(sceneId, node.id))
      const currentScene = readScene()
      const zIndexStart = Math.max(-1, ...(currentScene?.nodes.map((node) => node.zIndex) ?? [-1])) + 1
      const placeholders = createGenerationNodes(typedTask, placements, zIndexStart)
      placeholders.forEach((node) => addNode(sceneId, node))
      selectNodes(placeholders.length ? [placeholders[0].id] : [])
    } catch (error) {
      setSubmissionError(error instanceof Error ? error.message : '生成任务提交失败')
    } finally {
      setSubmitting(false)
    }
  }, [addNode, readScene, removeNode, resolveTask, sceneId, selectNodes, service, upsertTask])

  const generate = useCallback(async (
    prompt: string,
    preset: ImageSizePreset,
    count: number,
    center: CanvasPoint,
  ) => {
    const request = buildTextToImageRequest(prompt, preset, count)
    const placements = calculateGenerationPlacements(center, request.params.size, request.params.count)
    await submitParams(request.params, placements)
  }, [submitParams])

  const retry = useCallback(async () => {
    if (!displayedTask) return
    const placeholders = placeholdersForTask(displayedTask.id)
    const placements = placeholders.map(({ x, y, width, height }) => ({ x, y, width, height }))
    await submitParams(displayedTask.params, placements, placeholders)
  }, [displayedTask, placeholdersForTask, submitParams])

  const modifyParameters = useCallback(() => {
    if (displayedTask && sceneId) {
      placeholdersForTask(displayedTask.id).forEach((node) => removeNode(sceneId, node.id))
    }
    setTask(undefined)
    setActiveTaskId(undefined)
    setSubmissionError(undefined)
    setProtocolError(undefined)
    selectNodes([])
  }, [displayedTask, placeholdersForTask, removeNode, sceneId, selectNodes])

  const status = displayedTask?.status
  return {
    task: displayedTask,
    submitting,
    active: !!status && ACTIVE_STATUSES.has(status),
    formLocked: !!status && (ACTIVE_STATUSES.has(status) || status === 'failed' || status === 'cancelled'),
    submissionError,
    protocolError,
    pollError: taskQuery.error,
    polling: taskQuery.isFetching,
    generate,
    retry,
    modifyParameters,
    refetch: taskQuery.refetch,
  }
}
