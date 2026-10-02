// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorStore } from '@/editor/store'
import { createImageAsset } from '@/editor/services/assetService'
import { usePersistenceStore, recoveryForTask } from '@/editor/persistence/persistenceStore'
import { defaultDrafts } from '@/editor/persistence/types'
import { useTaskStore } from '@/store/useTaskStore'
import { useUserStore } from '@/store/useUserStore'
import type { ImageNode } from '@/editor/types'
import { Capability, type GenerationTask, type VariationTaskParams } from '@/types'
import { useCanvasVariationConfiguration } from './availability'
import { buildVariationRequest, type CanvasGenerationRequest } from './requestBuilder'
import { useFreeCanvasGenerationController } from './useFreeCanvasGenerationController'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER_OWNER = '22222222-2222-4222-8222-222222222222'
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
function taskFor(request: CanvasGenerationRequest, id = 'real-task', status: GenerationTask['status'] = 'processing'): GenerationTask<VariationTaskParams> {
  return {
    id, capability: Capability.Variation, modelProfileId: request.modelProfileId,
    params: request.params as VariationTaskParams, status, creditsCost: 6,
    createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z',
  }
}

describe('自由画布真实裂变闭环', () => {
  let root: Root
  let container: HTMLDivElement
  let sceneId: string
  let source: { asset: ReturnType<typeof createImageAsset>; node: ImageNode }
  let request: CanvasGenerationRequest
  beforeEach(async () => {
    vi.stubEnv('VITE_GENERATION_MODE', 'real')
    vi.resetAllMocks()
    mocks.polled = undefined
    mocks.upload.mockResolvedValue(`users/${OWNER}/task-inputs/original.png`)
    mocks.history.mockResolvedValue(undefined)
    mocks.flush.mockResolvedValue(undefined)
    mocks.find.mockResolvedValue(undefined)
    mocks.create.mockImplementation(async (input: CanvasGenerationRequest) => taskFor(input))
    useUserStore.setState({ userId: OWNER })
    useTaskStore.setState({ tasks: {} })
    useCanvasVariationConfiguration.setState({ ready: true, loading: false, models: [], error: undefined })
    usePersistenceStore.setState({ writable: true, epoch: 0, recoveries: {}, drafts: defaultDrafts() })
    const project = useEditorStore.getState().createProject('真实裂变测试')
    sceneId = project.document.activeSceneId
    const asset = createImageAsset({ id: 'source', name: '原图', url: 'data:image/png;base64,c291cmNl', width: 1600, height: 900 })
    const node: ImageNode = { id: 'source-node', type: 'image', assetId: asset.id, name: asset.name, x: 100, y: 80, width: 200, height: 100, rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0 }
    source = { asset, node }
    useEditorStore.getState().registerAsset(asset)
    useEditorStore.getState().addNode(sceneId, node)
    request = buildVariationRequest(asset, '柔和光线', 2, { resolution: '2k', modelProfileId: 'model-original' })
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

  it('上传完成并保存对象键请求后才提交，快速重复点击只创建一个任务', async () => {
    let release!: (key: string) => void
    mocks.upload.mockImplementationOnce(() => new Promise<string>(resolve => { release = resolve }))
    mocks.create.mockImplementationOnce(async (input: CanvasGenerationRequest) => {
      const saved = usePersistenceStore.getState().recoveries[request.requestId]
      expect(saved.request).toEqual(input)
      expect(saved.ownerId).toBe(OWNER)
      expect(mocks.flush).toHaveBeenCalled()
      return taskFor(input)
    })
    let pending!: Promise<void>
    await act(async () => {
      pending = controller.generateDerived(request, source)
      await controller.generateDerived(request, source)
    })
    expect(mocks.upload).toHaveBeenCalledTimes(1)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(controller.preparationPhase).toContain('上传原图')
    await act(async () => { release('owned-input'); await pending })
    const sent = mocks.create.mock.calls[0][0]
    expect(sent).toMatchObject({ requestId: request.requestId, modelProfileId: 'model-original', params: { sourceImageKey: 'owned-input', resolution: '2k', sourceWidth: 1600, sourceHeight: 900, size: { width: 2048, height: 1152 } } })
    expect(sent.params.sourceImageUrl).toBeUndefined()
    expect(recoveryForTask('real-task')?.context.autoRetryRemaining).toBe(0)
  })

  it('原图上传失败不提交任务、不插入占位，也不留下待续接请求', async () => {
    mocks.upload.mockRejectedValueOnce(new Error('上传失败'))
    await act(async () => controller.generateDerived(request, source))
    expect(mocks.create).not.toHaveBeenCalled()
    expect(usePersistenceStore.getState().recoveries).toEqual({})
    expect(useEditorStore.getState().project?.document.scenes[0].nodes).toEqual([source.node])
    expect(controller.formLocked).toBe(false)
    expect(controller.submissionError).toBe('上传失败')
  })

  it('真实失败不自动重试，手动重试保留模型、血缘与移动后的占位并使用新幂等键', async () => {
    await act(async () => controller.generateDerived(request, source))
    const first = controller.task!
    await act(async () => useEditorStore.getState().updateNode(sceneId, 'generation-node:real-task:0', { x: 777, y: 333 }))
    await poll({ ...first, status: 'failed', errorMessage: '服务暂时不可用', updatedAt: '2026-10-02T00:01:00Z' })
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(controller.autoRetrying).toBe(false)
    mocks.create.mockImplementationOnce(async (input: CanvasGenerationRequest) => taskFor(input, 'manual-retry'))
    await act(async () => Promise.all([controller.retry(), controller.retry()]))
    expect(mocks.create).toHaveBeenCalledTimes(2)
    const retried = mocks.create.mock.calls[1][0]
    expect(retried.requestId).not.toBe(request.requestId)
    expect(retried.modelProfileId).toBe('model-original')
    expect(retried.params).toEqual(first.params)
    expect(mocks.upload).toHaveBeenCalledTimes(2)
    expect(recoveryForTask('manual-retry')?.context).toMatchObject({ inputAssetIds: ['source'], autoRetryRemaining: 0, retryOfGenerationId: 'generation:real-task' })
    expect(useEditorStore.getState().project?.document.scenes[0].nodes.find(node => node.id === 'generation-node:manual-retry:0')).toMatchObject({ x: 777, y: 333 })
  })

  it('旧存档残留自动重试额度时，真实空结果仍只转为手动可恢复失败', async () => {
    await act(async () => controller.generateDerived(request, source))
    const first = controller.task!
    const recovery = recoveryForTask(first.id)!
    await act(async () => usePersistenceStore.getState().setRecovery({ ...recovery, context: { ...recovery.context, autoRetryRemaining: 1 } }))
    await reload()
    await poll({ ...first, status: 'succeeded', resultUrls: [], updatedAt: '2026-10-02T00:01:00Z' })
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(controller.task?.status).toBe('failed')
    expect(controller.protocolError).toBe('任务完成但未返回结果')
    expect(controller.autoRetrying).toBe(false)
    expect(useEditorStore.getState().project?.document.scenes[0].nodes.filter(node => node.type === 'generation')).toHaveLength(2)
  })

  it('部分成功按原始序号替换对应占位，整批结果只占一条撤销记录并补记资产', async () => {
    request = buildVariationRequest(source.asset, '', 4, { resolution: '2k', modelProfileId: 'model-original' })
    await act(async () => controller.generateDerived(request, source))
    const first = controller.task!
    await act(async () => useEditorStore.getState().updateNode(sceneId, 'generation-node:real-task:3', { x: 901, y: 502 }))
    const resultImages = [1, 3].map(ordinal => ({ ordinal, objectKey: `output-${ordinal}`, url: `https://images.example/${ordinal}.png`, expiresAt: Date.now() + 60_000, width: 2048, height: 1152, mimeType: 'image/png' }))
    const succeeded = { ...first, status: 'succeeded' as const, resultImages, warnings: ['PARTIAL'], creditsCost: 6, updatedAt: '2026-10-02T00:01:00Z' }
    await poll(succeeded)
    const state = useEditorStore.getState()
    expect(state.project?.document.scenes[0].nodes).toMatchObject([
      { id: 'source-node' }, { id: 'generated-node:real-task:1', x: 564, y: 80 }, { id: 'generated-node:real-task:3', x: 901, y: 502 },
    ])
    expect(state.project?.generations['generation:real-task'].outputAssetIds).toEqual(['asset:real-task:o1', 'asset:real-task:o3'])
    expect(state.undoStack).toHaveLength(1)
    expect(mocks.history).toHaveBeenCalledTimes(1)
    expect(mocks.history).toHaveBeenCalledWith(succeeded, OWNER, expect.any(AbortSignal))
    expect(controller.historySaved).toBe(true)
    await act(async () => state.undo())
    await reload()
    await poll(succeeded)
    expect(useEditorStore.getState().project?.document.scenes[0].nodes).toEqual([source.node])
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })

  it('结果历史保存失败可以重试保存，避免重新生成或重复插入结果', async () => {
    mocks.history.mockRejectedValueOnce(new Error('本地存储暂不可用')).mockResolvedValueOnce(undefined)
    await act(async () => controller.generateDerived(request, source))
    await poll({ ...controller.task!, status: 'succeeded', resultImages: [{ ordinal: 0, objectKey: 'output', url: 'https://images.example/output.png', expiresAt: Date.now(), width: 2048, height: 1152, mimeType: 'image/png' }], updatedAt: '2026-10-02T00:01:00Z' })
    expect(controller.historyError).toBe('本地存储暂不可用')
    await act(async () => controller.retryHistory())
    expect(mocks.history).toHaveBeenCalledTimes(2)
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(controller.historySaved).toBe(true)
    expect(controller.historyError).toBeUndefined()
    expect(useEditorStore.getState().undoStack).toHaveLength(1)
  })

  it('响应丢失后刷新先找回原任务，原请求与模型保持一致且不再上传或提交', async () => {
    mocks.create.mockRejectedValueOnce(new TypeError('连接中断'))
    await act(async () => controller.generateDerived(request, source))
    const original = usePersistenceStore.getState().recoveries[request.requestId].request
    await reload()
    mocks.find.mockResolvedValueOnce(taskFor(original, 'recovered'))
    await act(async () => controller.resumeSubmission())
    expect(mocks.find).toHaveBeenCalledWith(request.requestId)
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.upload).toHaveBeenCalledTimes(1)
    expect(controller.task?.id).toBe('recovered')
    expect(recoveryForTask('recovered')?.request).toEqual(original)
    expect(controller.pendingSubmission).toBeUndefined()
  })

  it('查询中断时保留等待，仅明确不存在后使用完全相同的请求继续提交', async () => {
    mocks.create.mockRejectedValueOnce(new TypeError('响应未知'))
    await act(async () => controller.generateDerived(request, source))
    const original = usePersistenceStore.getState().recoveries[request.requestId].request
    mocks.find.mockRejectedValueOnce(new Error('查询失败'))
    await act(async () => controller.resumeSubmission())
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(controller.pendingSubmission).toBeDefined()
    expect(controller.submissionError).toBe('查询失败')
    mocks.find.mockResolvedValueOnce(undefined)
    await act(async () => controller.resumeSubmission())
    expect(mocks.create.mock.calls[1][0]).toEqual(original)
    expect(mocks.upload).toHaveBeenCalledTimes(1)
    expect(controller.pendingSubmission).toBeUndefined()
  })

  it.each([400, 401, 402, 409, 422])('明确被拒绝的 %i 请求不锁死表单', async status => {
    mocks.create.mockRejectedValueOnce(Object.assign(new Error('请求被拒绝'), { status }))
    await act(async () => controller.generateDerived(request, source))
    expect(controller.pendingSubmission).toBeUndefined()
    expect(controller.formLocked).toBe(false)
    expect(usePersistenceStore.getState().recoveries[request.requestId].abandoned).toBe(true)
  })

  it('项目切换后到达的上传响应不提交任务，也不写入新项目', async () => {
    let release!: (key: string) => void
    mocks.upload.mockImplementationOnce(() => new Promise<string>(resolve => { release = resolve }))
    let submitting!: Promise<void>
    await act(async () => { submitting = controller.generateDerived(request, source) })
    await act(async () => { useEditorStore.getState().createProject('新项目') })
    await act(async () => { release('late-input'); await submitting })
    expect(mocks.create).not.toHaveBeenCalled()
    expect(useEditorStore.getState().project?.generations).toEqual({})
  })

  it('换账号后不能续接前一账号的未确认请求', async () => {
    mocks.create.mockRejectedValueOnce(new TypeError('响应未知'))
    await act(async () => controller.generateDerived(request, source))
    await act(async () => useUserStore.setState({ userId: OTHER_OWNER }))
    await act(async () => controller.resumeSubmission())
    expect(mocks.find).not.toHaveBeenCalled()
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(controller.submissionError).toContain('其他账号')
  })

  it('异账号的已绑定任务可以放弃本地占位，不查询任务或锁死后续编辑', async () => {
    await act(async () => controller.generateDerived(request, source))
    await act(async () => useUserStore.setState({ userId: OTHER_OWNER }))
    expect(controller.pendingSubmission?.backendTaskId).toBe('real-task')
    await act(async () => controller.abandonSubmission())
    expect(controller.pendingSubmission).toBeUndefined()
    expect(controller.formLocked).toBe(false)
    expect(useEditorStore.getState().project?.document.scenes[0].nodes).toEqual([source.node])
    expect(mocks.find).not.toHaveBeenCalled()
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })
})
