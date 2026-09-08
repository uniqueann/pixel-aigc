// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorStore } from '@/editor/store'
import { createImageAsset } from '@/editor/services/assetService'
import type { GenerationJob, ImageNode } from '@/editor/types'
import { useTaskStore } from '@/store/useTaskStore'
import {
  Capability,
  type GenerationTask,
  type TextToImageTaskParams,
  type TextToVideoTaskParams,
  type VariationTaskParams,
} from '@/types'
import { IMAGE_SIZE_PRESETS } from './config'
import {
  buildImageToVideoRequest,
  buildTextToImageRequest,
  buildTextToVideoRequest,
  buildVariationRequest,
  type CanvasGenerationTaskParams,
} from './requestBuilder'
import { useFreeCanvasGenerationController } from './useFreeCanvasGenerationController'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  polling: {
    data: undefined as GenerationTask<unknown> | undefined,
    error: null as Error | null,
    isFetching: false,
  },
  refetch: vi.fn(),
}))

vi.mock('@/services/api/task', () => ({ createTask: mocks.createTask }))
vi.mock('@/hooks/useTaskPolling', async () => {
  const { useEffect: useReactEffect } = await import('react')
  return {
    useTaskPolling: (_taskId: string | undefined, onTask?: (task: GenerationTask) => void) => {
      const polledTask = mocks.polling.data
      useReactEffect(() => {
        if (polledTask) onTask?.(polledTask as GenerationTask)
      }, [onTask, polledTask])
      return { ...mocks.polling, refetch: mocks.refetch }
    },
  }
})

type Controller = ReturnType<typeof useFreeCanvasGenerationController>
let currentController: Controller

function ControllerHarness({ sceneId }: { sceneId: string }) {
  const controller = useFreeCanvasGenerationController(sceneId)
  useEffect(() => {
    currentController = controller
  }, [controller])
  return null
}

describe('useFreeCanvasGenerationController 集成流程', () => {
  let container: HTMLDivElement
  let root: Root
  let sceneId: string

  beforeEach(async () => {
    mocks.createTask.mockReset()
    mocks.polling.data = undefined
    mocks.polling.error = null
    mocks.polling.isFetching = false
    mocks.refetch.mockReset()
    useTaskStore.setState({ tasks: {} })
    const project = useEditorStore.getState().createProject('自由画布测试')
    sceneId = project.document.activeSceneId
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(<ControllerHarness sceneId={sceneId} />))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  function addGeneratedSource() {
    const asset = createImageAsset({
      id: 'asset-source',
      name: '源图片',
      url: 'source.png',
      width: 1600,
      height: 900,
      source: 'generation',
      generationId: 'generation-origin',
    })
    const node: ImageNode = {
      id: 'node-source',
      type: 'image',
      assetId: asset.id,
      name: asset.name,
      x: 100,
      y: 80,
      width: 200,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 0,
    }
    const origin: GenerationJob = {
      id: 'generation-origin',
      capability: Capability.TextToImage,
      status: 'succeeded',
      input: {},
      inputAssetIds: [],
      outputAssetIds: [asset.id],
      createdAt: '2026-09-08T00:00:00.000Z',
      updatedAt: '2026-09-08T00:00:00.000Z',
    }
    const state = useEditorStore.getState()
    state.registerAsset(asset)
    state.registerGeneration(origin)
    state.addNode(sceneId, node)
    return { asset, node }
  }

  it('先插入无历史占位，再把全部结果作为一条命令写入画布', async () => {
    const params: TextToImageTaskParams = {
      prompt: '未来城市',
      size: { width: 1024, height: 1024 },
      count: 2,
    }
    const processingTask: GenerationTask<TextToImageTaskParams> = {
      id: 'task-canvas',
      capability: Capability.TextToImage,
      status: 'processing',
      params,
      creditsCost: 2,
      createdAt: '2026-09-07T00:00:00.000Z',
      updatedAt: '2026-09-07T00:00:00.000Z',
    }
    const succeededTask: GenerationTask<TextToImageTaskParams> = {
      ...processingTask,
      status: 'succeeded',
      resultUrls: ['first.png', 'second.png'],
      updatedAt: '2026-09-07T00:01:00.000Z',
    }
    mocks.createTask.mockResolvedValue(processingTask)

    await act(async () => {
      await currentController.generate(
        buildTextToImageRequest('未来城市', IMAGE_SIZE_PRESETS[0], 2),
        { x: 640, y: 360 },
      )
    })

    let state = useEditorStore.getState()
    expect(state.project?.document.scenes[0].nodes).toHaveLength(2)
    expect(state.project?.document.scenes[0].nodes.every((node) => node.type === 'generation')).toBe(true)
    expect(state.undoStack).toHaveLength(0)

    mocks.polling.data = succeededTask as unknown as GenerationTask<unknown>
    await act(async () => root.render(<ControllerHarness sceneId={sceneId} />))

    state = useEditorStore.getState()
    expect(state.project?.document.scenes[0].nodes).toHaveLength(2)
    expect(state.project?.document.scenes[0].nodes.every((node) => node.type === 'image')).toBe(true)
    expect(state.undoStack).toHaveLength(1)
    expect(Object.keys(state.project?.assets ?? {})).toEqual(['asset:task-canvas:0', 'asset:task-canvas:1'])

    await act(async () => state.undo())
    expect(useEditorStore.getState().project?.document.scenes[0].nodes).toHaveLength(0)
    expect(Object.keys(useEditorStore.getState().project?.assets ?? {})).toHaveLength(2)

    await act(async () => useEditorStore.getState().redo())
    expect(useEditorStore.getState().project?.document.scenes[0].nodes).toHaveLength(2)
  })

  it('失败后按原参数和移动后的位置重试，并允许清除占位修改参数', async () => {
    const params: TextToImageTaskParams = {
      prompt: '失败重试',
      size: { width: 1024, height: 768 },
      count: 1,
    }
    const processingTask: GenerationTask<TextToImageTaskParams> = {
      id: 'task-failed',
      capability: Capability.TextToImage,
      status: 'processing',
      params,
      creditsCost: 1,
      createdAt: '2026-09-07T00:00:00.000Z',
      updatedAt: '2026-09-07T00:00:00.000Z',
    }
    const failedTask: GenerationTask<TextToImageTaskParams> = {
      ...processingTask,
      status: 'failed',
      errorMessage: '模拟生成失败',
      updatedAt: '2026-09-07T00:01:00.000Z',
    }
    const retryTask: GenerationTask<TextToImageTaskParams> = {
      ...processingTask,
      id: 'task-retry',
      updatedAt: '2026-09-07T00:02:00.000Z',
    }
    mocks.createTask.mockResolvedValueOnce(processingTask).mockResolvedValueOnce(retryTask)

    await act(async () => {
      await currentController.generate(
        buildTextToImageRequest('失败重试', IMAGE_SIZE_PRESETS[1], 1),
        { x: 640, y: 360 },
      )
    })
    mocks.polling.data = failedTask as unknown as GenerationTask<unknown>
    await act(async () => root.render(<ControllerHarness sceneId={sceneId} />))

    let placeholder = useEditorStore.getState().project?.document.scenes[0].nodes[0]
    expect(currentController.formLocked).toBe(true)
    expect(placeholder?.type).toBe('generation')
    await act(async () => useEditorStore.getState().updateNode(sceneId, placeholder!.id, { x: 123, y: 456 }))

    await act(async () => currentController.retry())
    placeholder = useEditorStore.getState().project?.document.scenes[0].nodes[0]
    expect(placeholder).toMatchObject({
      id: 'generation-node:task-retry:0',
      type: 'generation',
      x: 123,
      y: 456,
    })
    expect(useEditorStore.getState().undoStack).toHaveLength(0)

    const retryFailedTask = {
      ...retryTask,
      status: 'failed' as const,
      errorMessage: '再次失败',
      updatedAt: '2026-09-07T00:03:00.000Z',
    }
    mocks.polling.data = retryFailedTask as unknown as GenerationTask<unknown>
    await act(async () => root.render(<ControllerHarness sceneId={sceneId} />))
    await act(async () => currentController.modifyParameters())
    expect(useEditorStore.getState().project?.document.scenes[0].nodes).toHaveLength(0)
    expect(currentController.formLocked).toBe(false)
  })

  it('把文生视频结果作为 VideoNode 写入画布并支持历史回放', async () => {
    const params: TextToVideoTaskParams = {
      prompt: '穿过霓虹城市的镜头',
      size: { width: 1280, height: 720 },
      durationSeconds: 10,
      count: 1,
    }
    const processingTask: GenerationTask<TextToVideoTaskParams> = {
      id: 'task-video',
      capability: Capability.TextToVideo,
      status: 'processing',
      params,
      creditsCost: 1,
      createdAt: '2026-09-08T00:00:00.000Z',
      updatedAt: '2026-09-08T00:00:00.000Z',
    }
    mocks.createTask.mockResolvedValue(processingTask)

    await act(async () => {
      await currentController.generate(
        buildTextToVideoRequest('穿过霓虹城市的镜头', IMAGE_SIZE_PRESETS[3], 10),
        { x: 640, y: 360 },
      )
    })
    expect(useEditorStore.getState().project?.document.scenes[0].nodes[0]?.type).toBe('generation')

    mocks.polling.data = {
      ...processingTask,
      status: 'succeeded',
      resultUrls: ['/mock/text-to-video-10s.mp4'],
      updatedAt: '2026-09-08T00:01:00.000Z',
    }
    await act(async () => root.render(<ControllerHarness sceneId={sceneId} />))

    let state = useEditorStore.getState()
    expect(state.project?.document.scenes[0].nodes[0]).toMatchObject({
      type: 'video',
      duration: 10,
      startTime: 0,
    })
    expect(state.project?.assets['asset:task-video:0']).toMatchObject({ type: 'video', duration: 10 })
    expect(state.undoStack).toHaveLength(1)

    await act(async () => state.undo())
    expect(useEditorStore.getState().project?.document.scenes[0].nodes).toHaveLength(0)
    await act(async () => useEditorStore.getState().redo())
    state = useEditorStore.getState()
    expect(state.project?.document.scenes[0].nodes[0]?.type).toBe('video')
  })

  it('从源图片裂变四个结果，在源图右侧排布并建立直接父代关系', async () => {
    let source!: ReturnType<typeof addGeneratedSource>
    await act(async () => { source = addGeneratedSource() })
    const params: VariationTaskParams = {
      sourceImageUrl: source.asset.url,
      prompt: '更柔和的光线',
      size: { width: 1600, height: 900 },
      count: 4,
    }
    const processingTask: GenerationTask<VariationTaskParams> = {
      id: 'task-variation',
      capability: Capability.Variation,
      status: 'processing',
      params,
      creditsCost: 4,
      createdAt: '2026-09-08T01:00:00.000Z',
      updatedAt: '2026-09-08T01:00:00.000Z',
    }
    mocks.createTask.mockResolvedValue(processingTask)

    await act(async () => {
      await currentController.generateDerived(
        buildVariationRequest(source.asset, '更柔和的光线', 4),
        source,
      )
    })

    let state = useEditorStore.getState()
    const placeholders = state.project?.document.scenes[0].nodes.filter((node) => node.type === 'generation') ?? []
    expect(placeholders).toMatchObject([
      { x: 332, y: 80, width: 200, height: 100 },
      { x: 564, y: 80, width: 200, height: 100 },
      { x: 332, y: 212, width: 200, height: 100 },
      { x: 564, y: 212, width: 200, height: 100 },
    ])
    expect(state.project?.generations['generation:task-variation']).toMatchObject({
      inputAssetIds: ['asset-source'],
      parentGenerationId: 'generation-origin',
    })

    await act(async () => useEditorStore.getState().removeNode(sceneId, source.node.id))
    mocks.polling.data = {
      ...processingTask,
      status: 'succeeded',
      resultUrls: ['one.png', 'two.png', 'three.png', 'four.png'],
      updatedAt: '2026-09-08T01:01:00.000Z',
    }
    await act(async () => root.render(<ControllerHarness sceneId={sceneId} />))

    state = useEditorStore.getState()
    expect(state.project?.document.scenes[0].nodes).toHaveLength(4)
    expect(state.project?.document.scenes[0].nodes.every((node) => node.type === 'image')).toBe(true)
    expect(state.project?.document.scenes[0].nodes[0]).toMatchObject({ x: 332, y: 80, width: 200, height: 100 })
    expect(state.undoStack).toHaveLength(1)
  })

  it('图生视频复用文生视频能力并继承源图片血缘', async () => {
    let source!: ReturnType<typeof addGeneratedSource>
    await act(async () => { source = addGeneratedSource() })
    const request = buildImageToVideoRequest(source.asset, '云层缓慢移动', 5)
    const processingTask: GenerationTask<CanvasGenerationTaskParams> = {
      id: 'task-image-video',
      capability: Capability.TextToVideo,
      status: 'processing',
      params: request.params,
      creditsCost: 1,
      createdAt: '2026-09-08T02:00:00.000Z',
      updatedAt: '2026-09-08T02:00:00.000Z',
    }
    mocks.createTask.mockResolvedValue(processingTask)

    await act(async () => currentController.generateDerived(request, source))
    mocks.polling.data = {
      ...processingTask,
      status: 'succeeded',
      resultUrls: ['/mock/text-to-video-5s.mp4'],
      updatedAt: '2026-09-08T02:01:00.000Z',
    }
    await act(async () => root.render(<ControllerHarness sceneId={sceneId} />))

    const state = useEditorStore.getState()
    expect(state.project?.document.scenes[0].nodes.find((node) => node.type === 'video')).toMatchObject({
      x: 332,
      y: 80,
      width: 200,
      height: 100,
      duration: 5,
    })
    expect(state.project?.generations['generation:task-image-video']).toMatchObject({
      capability: Capability.TextToVideo,
      inputAssetIds: ['asset-source'],
      parentGenerationId: 'generation-origin',
    })
  })

  it('派生任务失败后自动创建一次新任务并保留移动后的占位位置', async () => {
    let source!: ReturnType<typeof addGeneratedSource>
    await act(async () => { source = addGeneratedSource() })
    const request = buildVariationRequest(source.asset, '', 1)
    const firstTask: GenerationTask<CanvasGenerationTaskParams> = {
      id: 'task-first-attempt',
      capability: Capability.Variation,
      status: 'processing',
      params: request.params,
      creditsCost: 1,
      createdAt: '2026-09-08T03:00:00.000Z',
      updatedAt: '2026-09-08T03:00:00.000Z',
    }
    const retryTask: GenerationTask<CanvasGenerationTaskParams> = {
      ...firstTask,
      id: 'task-auto-retry',
      updatedAt: '2026-09-08T03:01:00.000Z',
    }
    mocks.createTask.mockResolvedValueOnce(firstTask).mockResolvedValueOnce(retryTask)

    await act(async () => currentController.generateDerived(request, source))
    const placeholder = useEditorStore.getState().project?.document.scenes[0].nodes
      .find((node) => node.type === 'generation')
    await act(async () => useEditorStore.getState().updateNode(sceneId, placeholder!.id, { x: 777, y: 333 }))

    mocks.polling.data = {
      ...firstTask,
      status: 'failed',
      errorMessage: '首次失败',
      updatedAt: '2026-09-08T03:02:00.000Z',
    }
    await act(async () => root.render(<ControllerHarness sceneId={sceneId} />))
    await act(async () => vi.waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(2)))

    const state = useEditorStore.getState()
    expect(state.project?.document.scenes[0].nodes.find((node) => node.type === 'generation')).toMatchObject({
      id: 'generation-node:task-auto-retry:0',
      x: 777,
      y: 333,
    })
    expect(state.project?.generations['generation:task-auto-retry']).toMatchObject({
      parentGenerationId: 'generation-origin',
      retryOfGenerationId: 'generation:task-first-attempt',
      inputAssetIds: ['asset-source'],
    })
    expect(currentController.autoRetrying).toBe(true)

    mocks.polling.data = {
      ...retryTask,
      status: 'failed',
      errorMessage: '再次失败',
      updatedAt: '2026-09-08T03:03:00.000Z',
    }
    await act(async () => root.render(<ControllerHarness sceneId={sceneId} />))
    expect(mocks.createTask).toHaveBeenCalledTimes(2)
    expect(currentController.formLocked).toBe(true)
    expect(currentController.autoRetrying).toBe(false)
  })

  it('空结果自动重试一次，第二次空结果转为可恢复的失败占位', async () => {
    let source!: ReturnType<typeof addGeneratedSource>
    await act(async () => { source = addGeneratedSource() })
    const request = buildVariationRequest(source.asset, '', 1)
    const firstTask: GenerationTask<CanvasGenerationTaskParams> = {
      id: 'task-empty-first',
      capability: Capability.Variation,
      status: 'processing',
      params: request.params,
      creditsCost: 1,
      createdAt: '2026-09-08T04:00:00.000Z',
      updatedAt: '2026-09-08T04:00:00.000Z',
    }
    const retryTask: GenerationTask<CanvasGenerationTaskParams> = {
      ...firstTask,
      id: 'task-empty-retry',
      updatedAt: '2026-09-08T04:01:00.000Z',
    }
    mocks.createTask.mockResolvedValueOnce(firstTask).mockResolvedValueOnce(retryTask)

    await act(async () => currentController.generateDerived(request, source))
    mocks.polling.data = {
      ...firstTask,
      status: 'succeeded',
      resultUrls: [],
      updatedAt: '2026-09-08T04:02:00.000Z',
    }
    await act(async () => root.render(<ControllerHarness sceneId={sceneId} />))
    await act(async () => vi.waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(2)))
    expect(useEditorStore.getState().project?.generations['generation:task-empty-first']).toMatchObject({
      status: 'failed',
      error: '任务完成但未返回结果',
    })

    mocks.polling.data = {
      ...retryTask,
      status: 'succeeded',
      resultUrls: [],
      updatedAt: '2026-09-08T04:03:00.000Z',
    }
    await act(async () => root.render(<ControllerHarness sceneId={sceneId} />))

    expect(mocks.createTask).toHaveBeenCalledTimes(2)
    expect(currentController.task).toMatchObject({ status: 'failed', errorMessage: '任务完成但未返回结果' })
    expect(currentController.protocolError).toBe('任务完成但未返回结果')
    expect(useEditorStore.getState().project?.document.scenes[0].nodes.some((node) => node.type === 'generation')).toBe(true)
  })

  it('取消任务不触发自动重试，提交错误也不会创建占位', async () => {
    let source!: ReturnType<typeof addGeneratedSource>
    await act(async () => { source = addGeneratedSource() })
    const request = buildVariationRequest(source.asset, '', 1)
    const processingTask: GenerationTask<CanvasGenerationTaskParams> = {
      id: 'task-cancelled-derived',
      capability: Capability.Variation,
      status: 'processing',
      params: request.params,
      creditsCost: 1,
      createdAt: '2026-09-08T05:00:00.000Z',
      updatedAt: '2026-09-08T05:00:00.000Z',
    }
    mocks.createTask.mockResolvedValue(processingTask)
    await act(async () => currentController.generateDerived(request, source))

    mocks.polling.data = {
      ...processingTask,
      status: 'cancelled',
      updatedAt: '2026-09-08T05:01:00.000Z',
    }
    await act(async () => root.render(<ControllerHarness sceneId={sceneId} />))
    expect(mocks.createTask).toHaveBeenCalledTimes(1)
    expect(currentController.task?.status).toBe('cancelled')

    await act(async () => currentController.modifyParameters())
    mocks.createTask.mockRejectedValueOnce(new Error('网络不可用'))
    await act(async () => currentController.generateDerived(request, source))
    expect(mocks.createTask).toHaveBeenCalledTimes(2)
    expect(currentController.submissionError).toBe('网络不可用')
    expect(useEditorStore.getState().project?.document.scenes[0].nodes.filter((node) => node.type === 'generation')).toHaveLength(0)
  })
})
