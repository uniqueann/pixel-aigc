// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MINIMAX_H3_VIDEO_MODEL, SEEDANCE_VIDEO_MODEL } from '@shared/video-models'
import { createImageAsset } from '@/editor/services/assetService'
import { useEditorStore } from '@/editor/store'
import { usePersistenceStore, recoveryForTask } from '@/editor/persistence/persistenceStore'
import { defaultDrafts } from '@/editor/persistence/types'
import { useTaskStore } from '@/store/useTaskStore'
import { useUserStore } from '@/store/useUserStore'
import { Capability, type GenerationTask } from '@/types'
import { useCanvasVideoConfiguration } from './availability'
import { IMAGE_SIZE_PRESETS } from './config'
import { buildImageToVideoRequest, buildTextToVideoRequest, type CanvasGenerationRequest } from './requestBuilder'
import { useFreeCanvasGenerationController } from './useFreeCanvasGenerationController'

const OWNER = '11111111-1111-4111-8111-111111111111'
const preset = IMAGE_SIZE_PRESETS.find(item => item.key === '16:9')!
const mocks = vi.hoisted(() => ({ create: vi.fn(), find: vi.fn(), upload: vi.fn(), history: vi.fn(), flush: vi.fn(), polled: undefined as GenerationTask<unknown> | undefined }))
vi.mock('@/cloud/client', () => ({ authEnabled: true, cloudEnabled: false }))
vi.mock('@/services/api/task', () => ({ createTask: mocks.create, findTaskByRequest: mocks.find }))
vi.mock('@/services/api/imageInput', () => ({ taskInputKey: mocks.upload }))
vi.mock('./history', () => ({ saveCanvasTaskHistory: mocks.history }))
vi.mock('@/editor/persistence/projectPersistence', () => ({ flushProject: mocks.flush }))
vi.mock('@/hooks/useTaskPolling', async () => {
  const { useEffect } = await import('react')
  return { useTaskPolling: (id?: string, callback?: (task: GenerationTask<unknown>) => void, enabled = true) => {
    const task = mocks.polled
    useEffect(() => { if (enabled && task?.id === id && task) callback?.(task) }, [id, task, callback, enabled])
    return { error: null, isFetching: false, refetch: vi.fn() }
  } }
})
function task(request: CanvasGenerationRequest): GenerationTask<unknown> {
  return { id: 'video-task', capability: Capability.TextToVideo, modelProfileId: request.modelProfileId, params: request.params,
    phase: 'queued', status: 'queued', creditsCost: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
}
beforeEach(() => {
  vi.stubEnv('VITE_GENERATION_MODE', 'real')
  vi.resetAllMocks(); mocks.polled = undefined
  mocks.create.mockImplementation(async request => task(request))
  mocks.history.mockResolvedValue(undefined); mocks.flush.mockResolvedValue(undefined)
  mocks.upload.mockResolvedValue(`temporary/task-inputs/${OWNER}/source`)
  useUserStore.setState({ userId: OWNER })
  useTaskStore.setState({ tasks: {} })
  usePersistenceStore.setState({ writable: true, epoch: 0, recoveries: {}, drafts: defaultDrafts(), cloud: undefined })
  useCanvasVideoConfiguration.setState({ ready: true, imageReady: true, loading: false, models: [SEEDANCE_VIDEO_MODEL, MINIMAX_H3_VIDEO_MODEL] })
  useEditorStore.getState().createProject('视频测试')
})
afterEach(() => { cleanup(); vi.unstubAllEnvs(); useUserStore.setState({ userId: null }) })

describe('自由画布真实视频闭环的受控验证', () => {
  it('H3 图生视频保存原参数，手动重试重新上传首帧且恢复不再创建', async () => {
    const source = createImageAsset({ name: '商品原图', url: 'data:image/png;base64,aa', width: 800, height: 1000 })
    useEditorStore.getState().registerAsset(source)
    const node = { id: 'source-node', type: 'image' as const, assetId: source.id, x: 0, y: 0, width: 240, height: 300, rotation: 0, zIndex: 0, opacity: 1, visible: true, locked: false }
    const request = buildImageToVideoRequest(source, '镜头推进', 10, { model: MINIMAX_H3_VIDEO_MODEL, resolution: '2k', generateAudio: false })
    mocks.create.mockImplementationOnce(async input => ({ ...task(input), status: 'failed', errorCode: 'GENERATION_FAILED' }))
    const sceneId = useEditorStore.getState().project!.document.activeSceneId
    const hook = renderHook(() => useFreeCanvasGenerationController(sceneId))
    await act(async () => hook.result.current.generateDerived(request, { asset: source, node }))
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ modelProfileId: 'minimax-h3', params: { mode: 'image_to_video', ratio: 'adaptive', resolution: '2k', generateAudio: true } })
    mocks.upload.mockResolvedValueOnce('fresh-image-key')
    await act(async () => hook.result.current.retry())
    expect(mocks.upload.mock.calls[1][2]).toMatchObject({ ownerId: OWNER, forceUpload: true })
    expect(mocks.create.mock.calls[1][0]).toMatchObject({ modelProfileId: 'minimax-h3', params: { resolution: '2k', sourceImageKey: 'fresh-image-key' } })
    expect(mocks.create.mock.calls[1][0].requestId).not.toBe(request.requestId)
    hook.unmount(); useTaskStore.setState({ tasks: {} })
    const restored = renderHook(() => useFreeCanvasGenerationController(sceneId))
    expect(restored.result.current.task?.params).toMatchObject({ mode: 'image_to_video', resolution: '2k', generateAudio: true })
    expect(mocks.create).toHaveBeenCalledTimes(2)
    expect(mocks.upload).toHaveBeenCalledTimes(2)
  })
  it('旧 H3 无声任务不能通过重试静默变为有声', async () => {
    const request = buildTextToVideoRequest('旧视频', preset, 5, { model: MINIMAX_H3_VIDEO_MODEL, generateAudio: true })
    mocks.create.mockImplementationOnce(async input => ({ ...task(input), params: { ...input.params, generateAudio: false }, status: 'failed' }))
    const sceneId = useEditorStore.getState().project!.document.activeSceneId
    const hook = renderHook(() => useFreeCanvasGenerationController(sceneId))
    await act(async () => hook.result.current.generate(request, { x: 100, y: 100 }))
    await act(async () => hook.result.current.retry())
    expect(hook.result.current.submissionError).toContain('原生有声')
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(recoveryForTask('video-task')?.abandoned).not.toBe(true)
  })
  it('H3 仅文生可用时，图生请求在上传前被阻止', async () => {
    useCanvasVideoConfiguration.setState({ models: [{ ...MINIMAX_H3_VIDEO_MODEL, availableModes: ['text_to_video'] }, SEEDANCE_VIDEO_MODEL] })
    const request = buildImageToVideoRequest({ url: 'source.png', width: 800, height: 1000 }, '商品展示', 5, { model: MINIMAX_H3_VIDEO_MODEL, generateAudio: true })
    const hook = renderHook(() => useFreeCanvasGenerationController(useEditorStore.getState().project!.document.activeSceneId))
    await act(async () => hook.result.current.generate(request, { x: 100, y: 100 }))
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(hook.result.current.submissionError).toContain('原视频模型暂不可用')
  })
  it('H3 手动重试读取原模型当前价格，不借用列表第一项的 Seedance 价格', async () => {
    const request = buildTextToVideoRequest('商品展示', preset, 5, { model: MINIMAX_H3_VIDEO_MODEL, resolution: '2k', generateAudio: false })
    mocks.create.mockImplementationOnce(async (input: CanvasGenerationRequest) => ({ ...task(input), status: 'failed', errorCode: 'GENERATION_FAILED' }))
    const sceneId = useEditorStore.getState().project!.document.activeSceneId
    const hook = renderHook(() => useFreeCanvasGenerationController(sceneId))
    await act(async () => hook.result.current.generate(request, { x: 100, y: 100 }))
    useCanvasVideoConfiguration.setState({ models: [SEEDANCE_VIDEO_MODEL, { ...MINIMAX_H3_VIDEO_MODEL, pricing: { ...MINIMAX_H3_VIDEO_MODEL.pricing, version: 'h3-current-price' } }] })
    await act(async () => hook.result.current.retry())
    expect(mocks.create).toHaveBeenCalledTimes(2)
    expect(mocks.create.mock.calls[1][0]).toMatchObject({ modelProfileId: 'minimax-h3', priceVersion: 'h3-current-price', params: { resolution: '2k' } })
    expect(mocks.create.mock.calls[1][0].requestId).not.toBe(request.requestId)
  })
  it('H3 原模型、2K 与价格版本随恢复记录保存，刷新只续接原请求', async () => {
    const request = buildTextToVideoRequest('静物商品缓慢旋转', preset, 10, { model: MINIMAX_H3_VIDEO_MODEL, resolution: '2k', generateAudio: true })
    const sceneId = useEditorStore.getState().project!.document.activeSceneId
    const hook = renderHook(() => useFreeCanvasGenerationController(sceneId))
    await act(async () => hook.result.current.generate(request, { x: 100, y: 100 }))
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ modelProfileId: 'minimax-h3', priceVersion: 'minimax-h3-video-v1', params: expect.objectContaining({ resolution: '2k', durationSeconds: 10 }) }))
    expect(recoveryForTask('video-task')?.request).toMatchObject({ modelProfileId: 'minimax-h3', params: { resolution: '2k' } })
    hook.unmount()
    useTaskStore.setState({ tasks: {} })
    const restored = renderHook(() => useFreeCanvasGenerationController(sceneId))
    expect(restored.result.current.task?.id).toBe('video-task')
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })
  it('请求携带价格版本、720p 和声音，快速重复点击只提交一次', async () => {
    const request = buildTextToVideoRequest('雨夜城市', preset, 10, { model: SEEDANCE_VIDEO_MODEL, generateAudio: true })
    const sceneId = useEditorStore.getState().project!.document.activeSceneId
    const { result } = renderHook(() => useFreeCanvasGenerationController(sceneId))
    await act(async () => Promise.all([result.current.generate(request, { x: 100, y: 100 }), result.current.generate(request, { x: 100, y: 100 })]))
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ priceVersion: SEEDANCE_VIDEO_MODEL.pricing.version,
      params: expect.objectContaining({ durationSeconds: 10, resolution: '720p', count: 1, generateAudio: true }) }))
    expect(recoveryForTask('video-task')?.request.priceVersion).toBe(request.priceVersion)
  })
  it('图生视频上传原图得到对象键，提交时删除外部 URL', async () => {
    const source = createImageAsset({ name: '原图', url: 'data:image/png;base64,aa', width: 600, height: 400 })
    useEditorStore.getState().registerAsset(source)
    const request = buildImageToVideoRequest(source, '镜头推进', 5, { model: SEEDANCE_VIDEO_MODEL, generateAudio: false })
    const sceneId = useEditorStore.getState().project!.document.activeSceneId
    const { result } = renderHook(() => useFreeCanvasGenerationController(sceneId))
    const node = { id: 'source-node', type: 'image' as const, assetId: source.id, x: 0, y: 0, width: 300, height: 200, rotation: 0, zIndex: 0, opacity: 1, visible: true, locked: false }
    await act(async () => result.current.generateDerived(request, { asset: source, node }))
    expect(mocks.upload).toHaveBeenCalledTimes(1)
    const submitted = mocks.create.mock.calls[0][0]
    expect(submitted.params).toMatchObject({ sourceImageKey: `temporary/task-inputs/${OWNER}/source`, ratio: 'adaptive', generateAudio: false })
    expect(submitted.params).not.toHaveProperty('sourceImageUrl')
  })
  it('关闭配置或云项目阻止付费创建，已经提交的任务刷新后继续恢复', async () => {
    const request = buildTextToVideoRequest('雨夜城市', preset, 5, { model: SEEDANCE_VIDEO_MODEL, generateAudio: false })
    const project = useEditorStore.getState().project!, sceneId = project.document.activeSceneId
    const hook = renderHook(() => useFreeCanvasGenerationController(sceneId))
    useCanvasVideoConfiguration.setState({ ready: false })
    await act(async () => hook.result.current.generate(request, { x: 100, y: 100 }))
    expect(mocks.create).not.toHaveBeenCalled()
    useCanvasVideoConfiguration.setState({ ready: true })
    await act(async () => usePersistenceStore.setState({ cloud: { revision: 1, pending: false } }))
    await act(async () => hook.result.current.generate(request, { x: 100, y: 100 }))
    expect(mocks.create).not.toHaveBeenCalled()
    await act(async () => usePersistenceStore.setState({ cloud: undefined }))
    await act(async () => hook.result.current.generate(request, { x: 100, y: 100 }))
    hook.unmount()
    useTaskStore.setState({ tasks: {} }); useCanvasVideoConfiguration.setState({ ready: false })
    const restored = renderHook(() => useFreeCanvasGenerationController(sceneId))
    expect(restored.result.current.task?.id).toBe('video-task')
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })
  it('真实元数据落位并写入资产，不重复创建生成任务', async () => {
    const request = buildTextToVideoRequest('雨夜城市', preset, 5, { model: SEEDANCE_VIDEO_MODEL, generateAudio: false })
    const sceneId = useEditorStore.getState().project!.document.activeSceneId
    const { result, rerender } = renderHook(() => useFreeCanvasGenerationController(sceneId))
    await act(async () => result.current.generate(request, { x: 100, y: 100 }))
    mocks.polled = { ...task(request), status: 'succeeded', phase: undefined, creditsCost: 50, resultVideos: [{ ordinal: 0,
      url: 'https://r2.test/video', objectKey: 'generated/video', width: 1280, height: 720, durationSeconds: 5.04, sizeBytes: 555,
      hasAudio: false, mimeType: 'video/mp4', retentionExpiresAt: new Date(Date.now() + 86400_000).toISOString() }] }
    await act(async () => rerender())
    const video = Object.values(useEditorStore.getState().project!.assets).find(asset => asset.type === 'video')
    expect(video).toMatchObject({ width: 1280, height: 720, duration: 5.04, objectKey: 'generated/video', hasAudio: false })
    expect(mocks.history).toHaveBeenCalledTimes(1)
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })
})
