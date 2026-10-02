// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorStore } from '@/editor/store'
import { usePersistenceStore, recoveryForTask } from '@/editor/persistence/persistenceStore'
import { defaultDrafts } from '@/editor/persistence/types'
import { useTaskStore } from '@/store/useTaskStore'
import { useUserStore } from '@/store/useUserStore'
import { Capability, type GenerationTask, type TextToImageTaskParams } from '@/types'
import { useCanvasTextToImageConfiguration } from './availability'
import { type CanvasGenerationRequest } from './requestBuilder'
import { useFreeCanvasGenerationController } from './useFreeCanvasGenerationController'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const OWNER = '11111111-1111-4111-8111-111111111111'
const mocks = vi.hoisted(() => ({
  create: vi.fn(), find: vi.fn(), upload: vi.fn(), history: vi.fn(), flush: vi.fn(),
  polled: undefined as GenerationTask<unknown> | undefined,
}))
vi.mock('@/cloud/client', () => ({ authEnabled: true, cloudEnabled: false }))
vi.mock('@/services/api/task', () => ({ createTask: mocks.create, findTaskByRequest: mocks.find }))
vi.mock('@/services/api/imageInput', () => ({ taskInputKey: mocks.upload }))
vi.mock('./history', () => ({ saveCanvasTaskHistory: mocks.history }))
vi.mock('@/editor/persistence/projectPersistence', () => ({ flushProject: mocks.flush }))
vi.mock('@/hooks/useTaskPolling', async () => {
  const { useEffect: effect } = await import('react')
  return { useTaskPolling: (id?: string, onTask?: (task: GenerationTask<unknown>) => void, enabled = true) => {
    const task = mocks.polled
    effect(() => { if (enabled && task && task.id === id) onTask?.(task) }, [id, task, enabled, onTask])
    return { error: null, isFetching: false, refetch: vi.fn() }
  } }
})

let controller: ReturnType<typeof useFreeCanvasGenerationController>
function Harness({ sceneId }: { sceneId: string }) {
  const state = useFreeCanvasGenerationController(sceneId)
  useEffect(() => { controller = state }, [state])
  return null
}
function taskFor(request: CanvasGenerationRequest, id = 'text-task'): GenerationTask<TextToImageTaskParams> {
  return {
    id, capability: Capability.TextToImage, modelProfileId: request.modelProfileId,
    params: request.params as TextToImageTaskParams, status: 'processing', creditsCost: 6,
    createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z',
  }
}

describe('自由画布真实文生图闭环', () => {
  let root: Root
  let container: HTMLDivElement
  let sceneId: string
  let request: CanvasGenerationRequest
  beforeEach(async () => {
    vi.stubEnv('VITE_GENERATION_MODE', 'real')
    vi.resetAllMocks()
    mocks.polled = undefined
    mocks.history.mockResolvedValue(undefined)
    mocks.flush.mockResolvedValue(undefined)
    mocks.find.mockResolvedValue(undefined)
    mocks.create.mockImplementation(async (input: CanvasGenerationRequest) => taskFor(input))
    useUserStore.setState({ userId: OWNER })
    useTaskStore.setState({ tasks: {} })
    useCanvasTextToImageConfiguration.setState({ ready: true, loading: false, models: [], error: undefined })
    usePersistenceStore.setState({ writable: true, epoch: 0, recoveries: {}, drafts: defaultDrafts() })
    const project = useEditorStore.getState().createProject('真实文生图测试')
    sceneId = project.document.activeSceneId
    request = {
      capability: Capability.TextToImage, requestId: crypto.randomUUID(), modelProfileId: 'original-model',
      params: { prompt: '雨夜城市', count: 2, resolution: '2k', size: { width: 2048, height: 1152 } },
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(<Harness sceneId={sceneId} />))
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    useUserStore.setState({ userId: null })
    vi.unstubAllEnvs()
  })
  async function poll(task: GenerationTask<unknown>) {
    mocks.polled = task
    await act(async () => root.render(<Harness sceneId={sceneId} />))
  }
  async function reload() {
    await act(async () => root.unmount())
    useTaskStore.setState({ tasks: {} })
    mocks.polled = undefined
    root = createRoot(container)
    await act(async () => root.render(<Harness sceneId={sceneId} />))
  }
  async function generate() {
    await act(async () => controller.generate(request, { x: 400, y: 300 }))
  }

  it('提交前保存完整无原图请求，快速重复点击只创建一次任务', async () => {
    mocks.create.mockImplementation(async (input: CanvasGenerationRequest) => {
      expect(usePersistenceStore.getState().recoveries[request.requestId]).toMatchObject({
        request: input, ownerId: OWNER, context: { inputAssetIds: [], autoRetryRemaining: 0 },
      })
      expect(mocks.flush).toHaveBeenCalled()
      return taskFor(input)
    })
    await act(async () => Promise.all([controller.generate(request, { x: 400, y: 300 }), controller.generate(request, { x: 400, y: 300 })]))
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.create).toHaveBeenCalledWith(request)
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(recoveryForTask('text-task')?.backendTaskId).toBe('text-task')
    expect(useEditorStore.getState().project?.document.scenes[0].nodes).toHaveLength(2)
  })

  it('模型未就绪时没有任务或待续接请求', async () => {
    useCanvasTextToImageConfiguration.setState({ ready: false })
    await generate()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(controller.submissionError).toContain('文生图模型尚未就绪')
    expect(usePersistenceStore.getState().recoveries).toEqual({})
  })

  it('旧 Mock 请求缺少分辨率时不意外发起真实付费任务', async () => {
    delete (request.params as TextToImageTaskParams).resolution
    await generate()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(controller.submissionError).toBe('请选择生成分辨率')
    expect(controller.pendingSubmission).toBeUndefined()
  })

  it('生成中刷新继续查询原任务，部分成功按序号落位并补存，撤销后刷新不复现', async () => {
    await generate()
    const first = controller.task!
    await act(async () => useEditorStore.getState().updateNode(sceneId, 'generation-node:text-task:1', { x: 901, y: 502 }))
    await reload()
    expect(controller.task?.id).toBe(first.id)
    const completed = {
      ...first, status: 'succeeded' as const, warnings: ['PARTIAL'], creditsCost: 3,
      resultImages: [{ ordinal: 1, objectKey: 'generated-output', url: 'https://images.example/1.png', width: 2048, height: 1152, mimeType: 'image/png' }],
      updatedAt: '2026-10-03T00:01:00Z',
    }
    await poll(completed)
    const state = useEditorStore.getState()
    expect(state.project?.document.scenes[0].nodes).toMatchObject([{ id: 'generated-node:text-task:1', x: 901, y: 502 }])
    expect(state.undoStack).toHaveLength(1)
    expect(mocks.history).toHaveBeenCalledWith(completed, OWNER, expect.any(AbortSignal))
    expect(controller.historySaved).toBe(true)
    await act(async () => state.undo())
    await reload()
    await poll(completed)
    expect(useEditorStore.getState().project?.document.scenes[0].nodes).toEqual([])
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })

  it.each(['failed', 'cancelled', 'empty'])('真实 %s 结果只允许手动重试并保留模型与移动后的占位', async outcome => {
    await generate()
    const first = controller.task!
    await act(async () => useEditorStore.getState().updateNode(sceneId, 'generation-node:text-task:0', { x: 812, y: 309 }))
    await poll({ ...first, status: outcome === 'empty' ? 'succeeded' : outcome as 'failed' | 'cancelled', updatedAt: '2026-10-03T00:01:00Z' })
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(controller.autoRetrying).toBe(false)
    mocks.create.mockImplementationOnce(async (input: CanvasGenerationRequest) => taskFor(input, 'retried-task'))
    await act(async () => controller.retry())
    const retried = mocks.create.mock.calls[1][0]
    expect(retried.requestId).not.toBe(request.requestId)
    expect(retried.modelProfileId).toBe(request.modelProfileId)
    expect(retried.params).toEqual(request.params)
    expect(recoveryForTask('retried-task')?.context).toMatchObject({ inputAssetIds: [], retryOfGenerationId: 'generation:text-task', autoRetryRemaining: 0 })
    expect(useEditorStore.getState().project?.document.scenes[0].nodes[0]).toMatchObject({ id: 'generation-node:retried-task:0', x: 812, y: 309 })
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('资产补存失败单独重试保存，不再次创建生成任务', async () => {
    mocks.history.mockRejectedValueOnce(new Error('保存暂不可用')).mockResolvedValueOnce(undefined)
    await generate()
    await poll({ ...controller.task!, status: 'succeeded', resultImages: [{ ordinal: 0, objectKey: 'output', url: 'https://images.example/output.png', width: 2048, height: 1152, mimeType: 'image/png' }], updatedAt: '2026-10-03T00:01:00Z' })
    expect(controller.historyError).toBe('保存暂不可用')
    await act(async () => controller.retryHistory())
    expect(controller.historySaved).toBe(true)
    expect(controller.historyError).toBeUndefined()
    expect(mocks.history).toHaveBeenCalledTimes(2)
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })

  it('响应未知时先找回原任务，找到后不重复提交', async () => {
    mocks.create.mockRejectedValueOnce(new TypeError('连接中断'))
    await generate()
    await reload()
    mocks.find.mockResolvedValueOnce(taskFor(request, 'found-task'))
    await act(async () => controller.resumeSubmission())
    expect(mocks.find).toHaveBeenCalledWith(request.requestId)
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(controller.task?.id).toBe('found-task')
    expect(recoveryForTask('found-task')?.request).toEqual(request)
  })

  it('查询失败保留等待，明确不存在时才按相同请求继续', async () => {
    mocks.create.mockRejectedValueOnce(new TypeError('响应未知'))
    await generate()
    mocks.find.mockRejectedValueOnce(new Error('查询失败'))
    await act(async () => controller.resumeSubmission())
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(controller.pendingSubmission).toBeDefined()
    mocks.find.mockResolvedValueOnce(undefined)
    await act(async () => controller.resumeSubmission())
    expect(mocks.create.mock.calls[1][0]).toEqual(request)
    expect(controller.pendingSubmission).toBeUndefined()
  })

  it('项目切换后到达的提交响应不写入新项目', async () => {
    let release!: (task: GenerationTask<TextToImageTaskParams>) => void
    mocks.create.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    let pending!: Promise<unknown>
    await act(async () => { pending = controller.generate(request, { x: 400, y: 300 }) })
    await act(async () => useEditorStore.getState().createProject('其他项目'))
    await act(async () => { release(taskFor(request)); await pending })
    expect(useEditorStore.getState().project?.generations).toEqual({})
    expect(useEditorStore.getState().project?.document.scenes[0].nodes).toEqual([])
  })
})
