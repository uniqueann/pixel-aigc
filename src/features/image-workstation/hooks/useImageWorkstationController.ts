import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTaskPolling } from '@/hooks/useTaskPolling'
import { uploadDataUrl } from '@/services/api/upload'
import { GenerationService } from '@/editor/services/generationService'
import { useEditorStore } from '@/editor/store'
import type { GenerationId, ImageAsset } from '@/editor/types'
import type { TaskAdapterOptions } from '@/editor/adapters/taskAdapter'
import type { WorkstationCanvasHandle, WorkstationToolDefinition } from '../types'

interface ControllerOptions {
  activeTool: WorkstationToolDefinition
  initialAsset: ImageAsset
  prompt?: string
}

export function useImageWorkstationController({ activeTool, initialAsset, prompt }: ControllerOptions) {
  const project = useEditorStore((state) => state.project)
  const createProject = useEditorStore((state) => state.createProject)
  const registerAsset = useEditorStore((state) => state.registerAsset)
  const registerGeneration = useEditorStore((state) => state.registerGeneration)
  const [inputAssetId, setInputAssetId] = useState(initialAsset.id)
  const [activeTaskId, setActiveTaskId] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const submissionsRef = useRef(new Map<string, TaskAdapterOptions>())
  const taskQuery = useTaskPolling(activeTaskId)

  useEffect(() => {
    let currentProject = useEditorStore.getState().project
    if (!currentProject) {
      createProject('图片工作台', { width: initialAsset.width, height: initialAsset.height })
      currentProject = useEditorStore.getState().project
    }
    if (!currentProject?.assets[initialAsset.id]) registerAsset(initialAsset)
  }, [createProject, initialAsset, registerAsset])

  const service = useMemo(() => new GenerationService({ registerAsset, registerGeneration }), [registerAsset, registerGeneration])
  const projectAsset = project?.assets[inputAssetId]
  const inputAsset = projectAsset?.type === 'image' ? projectAsset : initialAsset

  useEffect(() => {
    const task = taskQuery.data
    if (!task) return
    const options = submissionsRef.current.get(task.id)
    if (!options) return
    const adapted = service.reconcile(task, options)
    const firstImage = adapted.assets.find((asset): asset is ImageAsset => asset.type === 'image')
    if (task.status === 'succeeded' && firstImage) setInputAssetId(firstImage.id)
  }, [service, taskQuery.data])

  const generate = useCallback(async (canvasHandle: WorkstationCanvasHandle | null) => {
    const initialContext = { sourceAsset: inputAsset, prompt }
    const validation = activeTool.validate?.(initialContext)
    if (validation && !validation.valid) throw new Error(validation.message ?? '当前参数不完整')
    if (!canvasHandle) throw new Error('当前工具的画布交互仍在后续迭代中')

    setSubmitting(true)
    try {
      const mask = canvasHandle.exportMask()
      const maskUrl = await uploadDataUrl(mask.maskDataUrl)
      const targetSize = canvasHandle.getTargetSize?.()
      const originOffset = canvasHandle.getOriginOffset?.()
      const request = activeTool.buildRequest({
        ...initialContext,
        maskUrl,
        targetSize,
        originOffset,
      })
      const parentGenerationId: GenerationId | undefined = inputAsset.generationId
      const adapterOptions: TaskAdapterOptions & { inputAssetIds: string[] } = {
        inputAssetIds: [inputAsset.id],
        parentGenerationId,
        outputSize: request.outputSize,
      }
      const result = await service.submit({
        capability: request.capability,
        requestId: crypto.randomUUID(),
        params: request.params,
      }, adapterOptions)
      submissionsRef.current.set(result.task.id, adapterOptions)
      setActiveTaskId(result.task.id)
      const firstImage = result.assets.find((asset): asset is ImageAsset => asset.type === 'image')
      if (result.task.status === 'succeeded' && firstImage) setInputAssetId(firstImage.id)
      return result.task
    } finally {
      setSubmitting(false)
    }
  }, [activeTool, inputAsset, prompt, service])

  return {
    inputAsset,
    activeTask: taskQuery.data,
    submitting,
    generate,
  }
}
