// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorStore } from '@/editor/store'
import { useTaskStore } from '@/store/useTaskStore'
import {
  Capability,
  type GenerationTask,
  type TextToImageTaskParams,
  type TextToVideoTaskParams,
} from '@/types'
import { IMAGE_SIZE_PRESETS } from './config'
import { buildTextToImageRequest, buildTextToVideoRequest } from './requestBuilder'
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
})
