// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createImageAsset } from '@/editor/services/assetService'
import { useEditorStore } from '@/editor/store'
import { useUserStore } from '@/store/useUserStore'
import { Capability, type GenerationTask, type InpaintTaskParams } from '@/types'
import { RELIGHT_DEFAULT, type RelightOptions } from '@shared/relight'
import { getWorkstationTool } from '../tools/registry'
import type { WorkstationCanvasHandle } from '../types'
import { useImageWorkstationController } from './useImageWorkstationController'
import type { TaskInputUploadOptions } from '@/services/api/upload'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  liveCapabilityReady: vi.fn(() => true),
  uploadDataUrl: vi.fn(async (url: string) => url),
  uploadTaskInput: vi.fn<(blob: Blob, mimeType?: string, signal?: AbortSignal, options?: TaskInputUploadOptions) => Promise<string>>(async () => 'temporary/task-inputs/user/source-1'),
  requestErase: vi.fn(),
  requestRepaint: vi.fn(),
  requestOutpaint: vi.fn(),
  historySave: vi.fn(),
  polling: { data: undefined as GenerationTask<unknown> | undefined },
}))

vi.mock('@/features/assets/workstationHistory', async importOriginal => ({ ...(await importOriginal<typeof import('@/features/assets/workstationHistory')>()), recordWorkstationHistory: mocks.historySave }))
vi.mock('@/services/api/task', () => ({
  createTask: mocks.createTask,
  liveCapabilityReady: mocks.liveCapabilityReady,
}))
vi.mock('@/services/api/upload', () => ({
  uploadDataUrl: mocks.uploadDataUrl,
  uploadTaskInput: mocks.uploadTaskInput,
}))
vi.mock('@/services/api/erase', () => ({
  requestErase: mocks.requestErase,
}))
vi.mock('@/features/assets/historyOwner', async () => {
  const { useUserStore } = await import('@/store/useUserStore')
  const currentOwner = () => useUserStore.getState().userId ?? 'anonymous'
  return {
    currentWorkstationHistoryOwner: currentOwner,
    isCurrentWorkstationHistoryOwner: (ownerId: string) => currentOwner() === ownerId,
  }
})
vi.mock('@/services/api/outpaint', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/api/outpaint')>()), requestOutpaint: mocks.requestOutpaint,
}))
vi.mock('@/services/api/repaint', () => ({
  requestRepaint: mocks.requestRepaint,
}))
vi.mock('@/hooks/useTaskPolling', async () => {
  const { useEffect: useReactEffect } = await import('react')
  return {
    useTaskPolling: (_taskId: string | undefined, onTask?: (task: GenerationTask<unknown>) => void) => {
      const polledTask = mocks.polling.data
      useReactEffect(() => {
        if (polledTask) onTask?.(polledTask)
      }, [onTask, polledTask])
      return { data: polledTask, error: null, isFetching: false, refetch: vi.fn() }
    },
  }
})

const initialAsset = createImageAsset({
  id: 'asset:source',
  name: '原始图片',
  url: 'source.png',
  width: 640,
  height: 480,
})

const canvasHandle: WorkstationCanvasHandle = {
  exportMask: () => ({ maskDataUrl: 'data:image/png;base64,mask' }),
}

type Controller = ReturnType<typeof useImageWorkstationController>
let currentController: Controller

function captureController(controller: Controller) {
  currentController = controller
}

function ControllerHarness({
  tool = 'remove',
  prompt,
  count,
  resolution,
  modelProfileId,
  capabilityReady,
  retouchDirections,
  productAsset,
  referenceAsset,
  useProductAsset,
  relight,
  source = initialAsset,
  onController,
}: {
  tool?: string
  prompt?: string
  count?: number
  resolution?: '2k' | '4k'
  modelProfileId?: string
  capabilityReady?: (capability: Capability) => boolean
  retouchDirections?: Array<'blemish' | 'brighten' | 'sharpen' | 'texture'>
  productAsset?: typeof initialAsset
  referenceAsset?: typeof initialAsset
  useProductAsset?: boolean
  relight?: RelightOptions
  source?: typeof initialAsset
  onController: (controller: Controller) => void
}) {
  const controller = useImageWorkstationController({
    activeTool: getWorkstationTool(tool),
    initialAsset: source,
    prompt,
    count,
    resolution,
    modelProfileId,
    capabilityReady,
    retouchDirections,
    productAsset,
    referenceAsset,
    useProductAsset,
    relight,
  })
  useEffect(() => onController(controller), [controller, onController])
  return null
}

describe('useImageWorkstationController 集成流程', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    useUserStore.getState().setUser('11111111-1111-4111-8111-111111111111', 'free')
    mocks.historySave.mockReset().mockResolvedValue(undefined)
    mocks.createTask.mockReset()
    mocks.liveCapabilityReady.mockReset()
    mocks.liveCapabilityReady.mockReturnValue(true)
    mocks.uploadDataUrl.mockReset()
    mocks.uploadDataUrl.mockImplementation(async (url: string) => url)
    mocks.uploadTaskInput.mockReset()
    mocks.uploadTaskInput.mockResolvedValue('temporary/task-inputs/user/source-1')
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 640, height: 480, close: vi.fn() })))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), { headers: { 'Content-Type': 'image/png' } })))
    let blobIndex = 0
    URL.createObjectURL = vi.fn(() => `blob:result-${++blobIndex}`)
    URL.revokeObjectURL = vi.fn()
    mocks.requestErase.mockReset()
    mocks.requestRepaint.mockReset()
    mocks.requestOutpaint.mockReset()
    mocks.polling.data = undefined
    useEditorStore.setState({
      project: null,
      activeSceneId: null,
      selectedNodeIds: [],
      viewport: { zoom: 1, panX: 0, panY: 0 },
      undoStack: [],
      redoStack: [],
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(<ControllerHarness onController={captureController} />))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('将成功任务注册为 GenerationJob 和 Asset，并用结果继续下一代生成', async () => {
    const processingTask: GenerationTask<InpaintTaskParams> = {
      id: 'task-1',
      capability: Capability.Inpaint,
      status: 'processing',
      params: {
        sourceImageUrl: initialAsset.url,
        maskUrl: 'data:image/png;base64,mask',
        mode: 'remove',
      },
      creditsCost: 1,
      createdAt: '2026-09-07T00:00:00.000Z',
      updatedAt: '2026-09-07T00:00:00.000Z',
    }
    const firstSucceededTask: GenerationTask<InpaintTaskParams> = {
      ...processingTask,
      status: 'succeeded',
      resultUrls: ['first-result.png'],
      updatedAt: '2026-09-07T00:01:00.000Z',
    }
    const secondSucceededTask: GenerationTask<InpaintTaskParams> = {
      ...processingTask,
      id: 'task-2',
      status: 'succeeded',
      params: {
        sourceImageUrl: 'first-result.png',
        maskUrl: 'data:image/png;base64,mask',
        mode: 'remove',
      },
      resultUrls: ['second-result.png'],
      createdAt: '2026-09-07T00:02:00.000Z',
      updatedAt: '2026-09-07T00:03:00.000Z',
    }
    mocks.createTask
      .mockResolvedValueOnce(processingTask)
      .mockResolvedValueOnce(secondSucceededTask)

    await act(async () => {
      await currentController.generate(canvasHandle)
    })

    mocks.polling.data = firstSucceededTask
    await act(async () => root.render(<ControllerHarness onController={captureController} />))

    await vi.waitFor(async () => { await act(async () => {}); expect(currentController.outputAssets).toHaveLength(1) })
    const firstGeneration = useEditorStore.getState().project?.generations['generation:task-1']
    const firstAsset = useEditorStore.getState().project?.assets['asset:task-1:0']
    expect(firstGeneration).toMatchObject({
      status: 'succeeded',
      inputAssetIds: [initialAsset.id],
      outputAssetIds: ['asset:task-1:0'],
    })
    expect(firstAsset).toMatchObject({ url: 'first-result.png', generationId: 'generation:task-1' })
    expect(currentController.inputAsset?.id).toBe('asset:task-1:0')

    await act(async () => root.render(<ControllerHarness tool="repaint" onController={captureController} />))
    expect(currentController.inputAsset?.id).toBe('asset:task-1:0')
    await act(async () => root.render(<ControllerHarness tool="outpaint" onController={captureController} />))
    expect(currentController.inputAsset?.id).toBe('asset:task-1:0')
    await act(async () => root.render(<ControllerHarness onController={captureController} />))

    await act(async () => {
      await currentController.generate(canvasHandle)
    })

    await vi.waitFor(async () => { await act(async () => {}); expect(currentController.inputAsset?.id).toBe('asset:task-2:0') })
    const secondGeneration = useEditorStore.getState().project?.generations['generation:task-2']
    expect(secondGeneration).toMatchObject({
      status: 'succeeded',
      inputAssetIds: ['asset:task-1:0'],
      outputAssetIds: ['asset:task-2:0'],
      parentGenerationId: 'generation:task-1',
    })
    expect(currentController.inputAsset?.id).toBe('asset:task-2:0')
    expect(mocks.createTask).toHaveBeenNthCalledWith(2, expect.objectContaining({
      params: expect.objectContaining({ sourceImageUrl: expect.stringMatching(/^blob:/) }),
    }))
  })

  it('提交后切换账号时丢弃旧账号的轮询结果', async () => {
    const pending: GenerationTask = {
      id: 'task-before-account-switch',
      capability: Capability.ImageEdit,
      status: 'processing',
      params: { prompt: '白色背景', count: 1, resolution: '1k' },
      creditsCost: 2,
      createdAt: '2026-09-07T00:00:00.000Z',
      updatedAt: '2026-09-07T00:00:00.000Z',
    }
    mocks.createTask.mockResolvedValue(pending)
    await act(async () => root.render(<ControllerHarness tool="smart-edit" prompt="白色背景" onController={captureController} />))
    await act(async () => { await currentController.generate(null) })

    useUserStore.getState().setUser('22222222-2222-4222-8222-222222222222', 'free')
    mocks.polling.data = {
      ...pending,
      status: 'succeeded',
      resultUrls: ['old-account-result.png'],
      updatedAt: '2026-09-07T00:01:00.000Z',
    }
    await act(async () => root.render(<ControllerHarness tool="smart-edit" prompt="白色背景" onController={captureController} />))
    expect(currentController.outputAssets).toEqual([])
    expect(useEditorStore.getState().project?.assets['asset:task-before-account-switch:0']).toBeUndefined()
  })

  it('智能编辑无需画布句柄，并把全部结果暴露为可选候选', async () => {
    const processingTask: GenerationTask = {
      id: 'task-smart-edit',
      capability: Capability.ImageEdit,
      status: 'processing',
      params: {
        sourceImageUrl: initialAsset.url,
        prompt: '换成白色背景',
        count: 2,
        resolution: '2k',
        size: { width: 2048, height: 1536 },
      },
      creditsCost: 2,
      createdAt: '2026-09-07T00:00:00.000Z',
      updatedAt: '2026-09-07T00:00:00.000Z',
    }
    mocks.createTask.mockResolvedValue(processingTask)
    await act(async () => root.render(
      <ControllerHarness
        tool="smart-edit"
        prompt="换成白色背景"
        count={2}
        resolution="2k"
        onController={captureController}
      />,
    ))

    await act(async () => {
      await currentController.generate(null)
    })
    expect(mocks.uploadTaskInput).toHaveBeenCalled()
    expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({
      capability: Capability.ImageEdit,
      params: expect.objectContaining({
        prompt: '换成白色背景',
        count: 2,
        resolution: '2k',
        sourceImageKey: 'temporary/task-inputs/user/source-1',
      }),
    }))

    mocks.polling.data = {
      ...processingTask,
      status: 'succeeded',
      resultUrls: ['candidate-1.png', 'candidate-2.png'],
      updatedAt: '2026-09-07T00:01:00.000Z',
    }
    await act(async () => root.render(
      <ControllerHarness
        tool="smart-edit"
        prompt="换成白色背景"
        count={2}
        resolution="2k"
        onController={captureController}
      />,
    ))

    await vi.waitFor(async () => { await act(async () => {}); expect(currentController.outputAssets).toHaveLength(2) })
    expect(currentController.outputAssets.map((asset) => asset.id)).toEqual(['asset:task-smart-edit:0', 'asset:task-smart-edit:1'])
    await act(async () => currentController.selectOutput('asset:task-smart-edit:1'))
    expect(currentController.inputAsset?.id).toBe(currentController.outputAssets[1].id)
  })

  it('失败后使用原始图片和参数创建新的重试任务', async () => {
    const params = {
      sourceImageUrl: initialAsset.url,
      prompt: '移除阴影',
      count: 1,
      resolution: '2k' as const,
      size: { width: 2048, height: 1536 },
    }
    const failedTask: GenerationTask<typeof params> = {
      id: 'task-edit-failed',
      capability: Capability.ImageEdit,
      status: 'failed',
      params,
      errorMessage: '模拟失败',
      creditsCost: 1,
      createdAt: '2026-09-07T00:00:00.000Z',
      updatedAt: '2026-09-07T00:00:00.000Z',
    }
    const retryTask = { ...failedTask, id: 'task-edit-retry', status: 'processing' as const }
    mocks.createTask.mockResolvedValueOnce(failedTask).mockResolvedValueOnce(retryTask)
    await act(async () => root.render(
      <ControllerHarness tool="smart-edit" prompt="移除阴影" onController={captureController} />,
    ))

    await act(async () => {
      await currentController.generate(null)
    })
    await act(async () => {
      await currentController.retry()
    })

    expect(mocks.createTask).toHaveBeenCalledTimes(2)
    expect(mocks.createTask.mock.calls[1][0].params).toEqual(mocks.createTask.mock.calls[0][0].params)
    expect(currentController.activeTask?.id).toBe('task-edit-retry')
  })

  it('未接入真实服务的工具在上传蒙版前就拒绝提交', async () => {
    mocks.liveCapabilityReady.mockReturnValue(false)
    await act(async () => root.render(
      <ControllerHarness tool="relight" onController={captureController} />,
    ))

    await expect(currentController.generate(canvasHandle)).rejects.toThrow('该能力即将上线，目前还不能提交生成任务')
    expect(mocks.uploadDataUrl).not.toHaveBeenCalled()
    expect(mocks.createTask).not.toHaveBeenCalled()
  })

  it('重绘空蒙版时直接拒绝提交', async () => {
    mocks.liveCapabilityReady.mockReturnValue(false)
    await act(async () => root.render(
      <ControllerHarness tool="repaint" prompt="一盆小型绿色盆栽" onController={captureController} />,
    ))
    await expect(currentController.generate({
      exportMask: () => { throw new Error('请先涂抹要消除的区域') },
    })).rejects.toThrow('请先涂抹要重绘的区域')
    expect(mocks.requestRepaint).not.toHaveBeenCalled()
  })

  it('重绘结果若与原图字节相同则记为异常，不当成功结果', async () => {
    mocks.liveCapabilityReady.mockReturnValue(false)
    const bytes = new Uint8Array([255, 216, 255, 1, 2, 3, 4, 5])
    mocks.requestRepaint.mockImplementation(async (image: Blob) => image)
    const fetchMock = vi.fn(async () => new Response(bytes, { headers: { 'Content-Type': 'image/jpeg' } }))
    vi.stubGlobal('fetch', fetchMock)
    if (!URL.createObjectURL) {
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:repaint-echo' })
    }
    await act(async () => root.render(
      <ControllerHarness tool="repaint" prompt="一盆小型绿色盆栽" onController={captureController} />,
    ))
    await act(async () => {
      await currentController.generate(canvasHandle)
    })
    expect(currentController.protocolError).toBe('任务已完成，但没有返回新的生成结果')
    expect(currentController.outputAssets).toEqual([])
    expect(currentController.inputAsset?.id).toBe(initialAsset.id)
    vi.unstubAllGlobals()
  })

  it('重绘未接入任务网关时走 /api/repaint，不上传蒙版也不创建任务', async () => {
    mocks.liveCapabilityReady.mockReturnValue(false)
    const result = new Blob([new Uint8Array([255, 216, 255])], { type: 'image/jpeg' })
    mocks.requestRepaint.mockResolvedValue(result)
    const fetchMock = vi.fn(async () => new Response(new Blob([new Uint8Array(8)], { type: 'image/jpeg' })))
    vi.stubGlobal('fetch', fetchMock)
    if (!URL.createObjectURL) {
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:repaint-result' })
    }
    await act(async () => root.render(
      <ControllerHarness tool="repaint" prompt="桌面上的透明玻璃花瓶" onController={captureController} />,
    ))

    await act(async () => {
      await currentController.generate(canvasHandle)
    })

    expect(mocks.requestRepaint).toHaveBeenCalled()
    expect(mocks.requestRepaint.mock.calls[0][1]).toBe('data:image/png;base64,mask')
    expect(mocks.requestRepaint.mock.calls[0][2]).toBe('桌面上的透明玻璃花瓶')
    expect(mocks.uploadDataUrl).not.toHaveBeenCalled()
    expect(mocks.createTask).not.toHaveBeenCalled()
    expect(currentController.activeTask?.capability).toBe(Capability.Inpaint)
    expect(currentController.activeTask?.status).toBe('succeeded')
    expect(currentController.activeTask?.resultImages?.[0]).toMatchObject({ mimeType: 'image/jpeg', width: 640, height: 480 })
    expect(currentController.outputAssets[0].mimeType).toBe('image/jpeg')
    vi.unstubAllGlobals()
  })

  it('消除未接入任务网关时走 /api/erase，不上传蒙版也不创建任务', async () => {
    mocks.liveCapabilityReady.mockReturnValue(false)
    const result = new Blob([new Uint8Array([255, 216, 255])], { type: 'image/jpeg' })
    mocks.requestErase.mockResolvedValue(result)
    const fetchMock = vi.fn(async () => new Response(new Blob([new Uint8Array(8)], { type: 'image/jpeg' })))
    vi.stubGlobal('fetch', fetchMock)
    if (!URL.createObjectURL) {
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:erase-result' })
    }
    await act(async () => root.render(
      <ControllerHarness tool="remove" prompt="浅色木桌" onController={captureController} />,
    ))

    await act(async () => {
      await currentController.generate(canvasHandle)
    })

    expect(mocks.requestErase).toHaveBeenCalled()
    expect(mocks.requestErase.mock.calls[0][2]).toBe('data:image/png;base64,mask')
    expect(mocks.requestErase.mock.calls[0][3]).toBe('浅色木桌')
    expect(mocks.uploadDataUrl).not.toHaveBeenCalled()
    expect(mocks.createTask).not.toHaveBeenCalled()
    expect(currentController.activeTask?.capability).toBe(Capability.Inpaint)
    expect(currentController.activeTask?.status).toBe('succeeded')
    expect(currentController.activeTask?.resultImages?.[0]).toMatchObject({ mimeType: 'image/jpeg', width: 640, height: 480 })
    expect(currentController.outputAssets[0].mimeType).toBe('image/jpeg')
    vi.unstubAllGlobals()
  })

  it('同步扩图记录实际 JPEG 格式，结果可直接进行下一轮，并拒绝错误结果尺寸', async () => {
    mocks.liveCapabilityReady.mockReturnValue(false)
    mocks.requestOutpaint.mockResolvedValue(new Blob([new Uint8Array([255, 216, 255, 224, 0, 16])], { type: 'image/png' }))
    vi.mocked(createImageBitmap).mockResolvedValue({ width: 800, height: 480, close: vi.fn() } as unknown as ImageBitmap)
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn().mockReturnValueOnce('blob:outpaint-first').mockReturnValueOnce('blob:outpaint-second') })
    await act(async () => root.render(<ControllerHarness tool="outpaint" onController={captureController} />))
    const canvas = { ...canvasHandle, getTargetSize: () => ({ width: 800, height: 480 }), getOriginOffset: () => ({ x: 80, y: 0 }) }
    await act(async () => { await currentController.generate(canvas) })
    expect(currentController.activeTask?.resultImages?.[0]).toMatchObject({ width: 800, height: 480, mimeType: 'image/jpeg' })
    expect(currentController.inputAsset?.mimeType).toBe('image/jpeg')
    expect(currentController.inputAsset?.width).toBe(800)
    mocks.requestOutpaint.mockResolvedValue(new Blob([new Uint8Array([255, 216, 255, 224, 0, 17])], { type: 'image/jpeg' }))
    vi.mocked(createImageBitmap).mockResolvedValue({ width: 960, height: 480, close: vi.fn() } as unknown as ImageBitmap)
    await act(async () => { await currentController.generate({ ...canvas, getTargetSize: () => ({ width: 960, height: 480 }) }) })
    expect(mocks.requestOutpaint).toHaveBeenLastCalledWith(expect.any(Blob), 'image/jpeg', { left: 80, right: 80, top: 0, bottom: 0 }, undefined, expect.objectContaining({ onObjectResult: expect.any(Function) }))
    expect(currentController.inputAsset?.width).toBe(960)
    await act(async () => {
      await expect(currentController.generate({ ...canvas, getTargetSize: () => ({ width: 1120, height: 480 }) })).rejects.toThrow('尺寸与目标不一致')
    })
    vi.unstubAllGlobals()
  })

  it('裂变未接入时不能提交；成功结果若只回传原图则记为异常', async () => {
    mocks.liveCapabilityReady.mockReturnValue(false)
    await act(async () => root.render(
      <ControllerHarness tool="variation" onController={captureController} />,
    ))
    await expect(currentController.generate(null)).rejects.toThrow('该能力即将上线，目前还不能提交生成任务')

    mocks.liveCapabilityReady.mockReturnValue(true)
    const processingTask: GenerationTask = {
      id: 'task-variation-echo',
      capability: Capability.Variation,
      status: 'processing',
      params: { sourceImageUrl: initialAsset.url, size: { width: 640, height: 480 }, count: 1 },
      creditsCost: 1,
      createdAt: '2026-09-07T00:00:00.000Z',
      updatedAt: '2026-09-07T00:00:00.000Z',
    }
    mocks.createTask.mockResolvedValue(processingTask)
    await act(async () => root.render(
      <ControllerHarness tool="variation" onController={captureController} />,
    ))
    await act(async () => {
      await currentController.generate(null)
    })

    mocks.polling.data = {
      ...processingTask,
      status: 'succeeded',
      resultUrls: [initialAsset.url],
      updatedAt: '2026-09-07T00:01:00.000Z',
    }
    await act(async () => root.render(
      <ControllerHarness tool="variation" onController={captureController} />,
    ))

    expect(currentController.protocolError).toBe('任务已完成，但没有返回新的生成结果')
    expect(currentController.outputAssets).toEqual([])
    expect(currentController.inputAsset?.id).toBe(initialAsset.id)
  })

  it('工作站本地开关打开时提交裂变，不依赖全局能力注册', async () => {
    mocks.liveCapabilityReady.mockReturnValue(false)
    const processingTask: GenerationTask = {
      id: 'task-variation-local',
      capability: Capability.Variation,
      status: 'processing',
      params: { count: 2, resolution: '2k' },
      creditsCost: 2,
      createdAt: '2026-09-07T00:00:00.000Z',
      updatedAt: '2026-09-07T00:00:00.000Z',
    }
    mocks.createTask.mockResolvedValue(processingTask)
    await act(async () => root.render(
      <ControllerHarness
        tool="variation"
        prompt="  只换背景  "
        count={2}
        resolution="2k"
        capabilityReady={(capability) => capability === Capability.Variation}
        onController={captureController}
      />,
    ))
    await act(async () => {
      await currentController.generate(null)
    })
    expect(mocks.uploadTaskInput).toHaveBeenCalled()
    expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({
      capability: Capability.Variation,
      params: expect.objectContaining({
        prompt: '只换背景',
        count: 2,
        resolution: '2k',
        sourceImageKey: 'temporary/task-inputs/user/source-1',
      }),
    }))
  })

  it('两张里成功一张时留下结果，并保留部分成功警告', async () => {
    mocks.liveCapabilityReady.mockReturnValue(false)
    const processingTask: GenerationTask = {
      id: 'task-variation-partial',
      capability: Capability.Variation,
      status: 'processing',
      params: { sourceImageUrl: initialAsset.url, count: 2, resolution: '2k' },
      creditsCost: 2,
      createdAt: '2026-09-07T00:00:00.000Z',
      updatedAt: '2026-09-07T00:00:00.000Z',
    }
    mocks.createTask.mockResolvedValue(processingTask)
    await act(async () => root.render(
      <ControllerHarness
        tool="variation"
        count={2}
        capabilityReady={(capability) => capability === Capability.Variation}
        onController={captureController}
      />,
    ))
    await act(async () => {
      await currentController.generate(null)
    })
    const submitted = mocks.createTask.mock.calls[mocks.createTask.mock.calls.length - 1]?.[0]
    expect(submitted?.params).not.toHaveProperty('prompt')

    mocks.polling.data = {
      ...processingTask,
      status: 'succeeded',
      resultUrls: ['candidate-only.png'],
      warnings: ['PARTIAL'],
      updatedAt: '2026-09-07T00:01:00.000Z',
    }
    await act(async () => root.render(
      <ControllerHarness
        tool="variation"
        count={2}
        capabilityReady={(capability) => capability === Capability.Variation}
        onController={captureController}
      />,
    ))
    expect(currentController.activeTask?.status).toBe('succeeded')
    expect(currentController.activeTask?.warnings).toEqual(['PARTIAL'])
    await vi.waitFor(async () => { await act(async () => {}); expect(currentController.outputAssets).toHaveLength(1) })
    expect(currentController.outputAssets[0].url).toMatch(/^blob:/)
    expect(currentController.protocolError).toBeUndefined()
  })

  it('精修未选方向不能提交；选中后按智能编辑任务上传原图', async () => {
    mocks.liveCapabilityReady.mockReturnValue(false)
    const ready = (capability: Capability) => capability === Capability.Retouch || capability === Capability.ImageEdit
    await act(async () => root.render(
      <ControllerHarness tool="retouch" capabilityReady={ready} onController={captureController} />,
    ))
    await expect(currentController.generate(null)).rejects.toThrow('请先选择精修方向')
    expect(mocks.createTask).not.toHaveBeenCalled()

    mocks.createTask.mockResolvedValue({
      id: 'task-retouch',
      capability: Capability.ImageEdit,
      status: 'processing',
      params: { count: 1, resolution: '2k', retouchDirections: ['blemish'] },
      creditsCost: 1,
      createdAt: '2026-09-07T00:00:00.000Z',
      updatedAt: '2026-09-07T00:00:00.000Z',
    })
    await act(async () => root.render(
      <ControllerHarness
        tool="retouch"
        count={1}
        resolution="2k"
        retouchDirections={['blemish']}
        capabilityReady={ready}
        onController={captureController}
      />,
    ))
    await act(async () => {
      await currentController.generate(null)
    })
    expect(mocks.uploadTaskInput).toHaveBeenCalled()
    expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({
      capability: Capability.ImageEdit,
      params: expect.objectContaining({
        count: 1,
        resolution: '2k',
        sourceImageKey: 'temporary/task-inputs/user/source-1',
        retouchDirections: ['blemish'],
      }),
    }))
    const submitted = mocks.createTask.mock.calls[mocks.createTask.mock.calls.length - 1]?.[0]
    expect(submitted?.params).not.toHaveProperty('prompt')
  })

  it('融合缺场景图不能提交；两张齐了按商品图在前上传', async () => {
    mocks.liveCapabilityReady.mockReturnValue(false)
    const scene = createImageAsset({ id: 'asset:scene', name: '场景', url: 'scene.png', width: 900, height: 600 })
    const ready = (capability: Capability) => capability === Capability.Fusion || capability === Capability.ImageEdit
    await act(async () => root.render(
      <ControllerHarness
        tool="fusion"
        productAsset={initialAsset}
        useProductAsset
        capabilityReady={ready}
        onController={captureController}
      />,
    ))
    await expect(currentController.generate(null)).rejects.toThrow('请先上传商品图和场景图')
    expect(mocks.createTask).not.toHaveBeenCalled()

    mocks.uploadTaskInput
      .mockResolvedValueOnce('temporary/task-inputs/user/product')
      .mockResolvedValueOnce('temporary/task-inputs/user/scene')
    mocks.createTask.mockResolvedValue({
      id: 'task-fusion',
      capability: Capability.ImageEdit,
      status: 'processing',
      params: { count: 1, resolution: '2k' },
      creditsCost: 1,
      createdAt: '2026-09-07T00:00:00.000Z',
      updatedAt: '2026-09-07T00:00:00.000Z',
    })
    await act(async () => root.render(
      <ControllerHarness
        tool="fusion"
        count={1}
        resolution="2k"
        productAsset={initialAsset}
        referenceAsset={scene}
        useProductAsset
        capabilityReady={ready}
        onController={captureController}
      />,
    ))
    await act(async () => {
      await currentController.generate(null)
    })
    expect(mocks.uploadTaskInput).toHaveBeenCalledTimes(2)
    expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({
      capability: Capability.ImageEdit,
      params: expect.objectContaining({
        count: 1,
        resolution: '2k',
        sourceImageKey: 'temporary/task-inputs/user/product',
        referenceImageKey: 'temporary/task-inputs/user/scene',
        sourceWidth: 640,
        sourceHeight: 480,
      }),
    }))
  })

  it('重新打光有原图即可提交，默认两张并带上光效', async () => {
    mocks.liveCapabilityReady.mockReturnValue(false)
    mocks.createTask.mockResolvedValue({
      id: 'task-relight',
      capability: Capability.ImageEdit,
      status: 'processing',
      params: { count: 2, resolution: '2k', relight: RELIGHT_DEFAULT },
      creditsCost: 2,
      createdAt: '2026-09-07T00:00:00.000Z',
      updatedAt: '2026-09-07T00:00:00.000Z',
    })
    await act(async () => root.render(
      <ControllerHarness
        tool="relight"
        count={2}
        resolution="2k"
        relight={{ direction: 'left', quality: 'soft', temperature: 'warm' }}
        capabilityReady={(capability) => capability === Capability.Relight}
        onController={captureController}
      />,
    ))
    await act(async () => {
      await currentController.generate(null)
    })
    expect(mocks.uploadTaskInput).toHaveBeenCalled()
    expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({
      capability: Capability.ImageEdit,
      params: expect.objectContaining({
        count: 2,
        resolution: '2k',
        sourceImageKey: 'temporary/task-inputs/user/source-1',
        relight: { direction: 'left', quality: 'soft', temperature: 'warm' },
      }),
    }))
  })

  it('链式编辑用结果 objectKey，不 fetch 签名 URL', async () => {
    const resultAsset = createImageAsset({
      id: 'asset:generated',
      name: '上一轮结果',
      url: 'https://r2.example/generated/u/job/0.png?X-Amz-Signature=secret',
      objectKey: 'generated/u/job/0.png',
      width: 640,
      height: 480,
      source: 'generation',
    })
    mocks.createTask.mockResolvedValue({
      id: 'task-chain',
      capability: Capability.Variation,
      status: 'processing',
      params: { count: 2, resolution: '2k' },
      creditsCost: 1,
      createdAt: '2026-09-07T00:00:00.000Z',
      updatedAt: '2026-09-07T00:00:00.000Z',
    })
    await act(async () => root.render(
      <ControllerHarness
        key="chain"
        tool="variation"
        count={2}
        resolution="2k"
        source={resultAsset}
        capabilityReady={(capability) => capability === Capability.Variation}
        onController={captureController}
      />,
    ))
    await act(async () => {
      await currentController.generate(null)
    })
    const fetchMock = vi.mocked(fetch)
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('r2.example'))).toBe(false)
    expect(mocks.uploadTaskInput).not.toHaveBeenCalled()
    expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({
      capability: Capability.Variation,
      params: expect.objectContaining({
        sourceImageKey: 'generated/u/job/0.png',
      }),
    }))
  })
  it('同步对象结果下载失败只重试 GET，保存失败只重试同一 Blob', async () => {
    mocks.liveCapabilityReady.mockReturnValue(false)
    const descriptor = { objectKey: 'temporary/repaint-results/u/retry.jpg', url: 'https://r2.test/retry', mimeType: 'image/jpeg' as const, expiresAt: Date.now() + 60_000 }
    mocks.requestRepaint.mockImplementation(async (_image, _mask, _prompt, _key, options) => {
      options.onObjectResult(descriptor)
      throw new Error('下载中断')
    })
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url)
      const fromResult = target.startsWith('https:') || target.startsWith('/api/objects')
      return new Response(new Uint8Array([255, 216, 255, fromResult ? 5 : 1]), { headers: { 'Content-Type': 'image/jpeg' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    mocks.historySave.mockRejectedValueOnce(new DOMException('空间不足', 'QuotaExceededError')).mockResolvedValue(undefined)
    await act(async () => root.render(<ControllerHarness tool="repaint" prompt="白色桌面" onController={captureController} />))
    await act(async () => { await expect(currentController.generate(canvasHandle)).rejects.toThrow('下载中断') })
    expect(currentController.activeTask?.status).toBe('succeeded')
    expect(currentController.resultReadError).toBe('下载中断')
    await act(async () => { await currentController.retryRead() })
    await vi.waitFor(async () => { await act(async () => {}); expect(currentController.historyError).toContain('存储空间不足') })
    expect(currentController.outputAssets).toHaveLength(1)
    expect(mocks.requestRepaint).toHaveBeenCalledTimes(1)
    expect(mocks.createTask).not.toHaveBeenCalled()
    const savedBlob = mocks.historySave.mock.calls[0][1].result
    const networkCount = fetchMock.mock.calls.length
    await act(async () => { await currentController.retrySave() })
    expect(mocks.historySave.mock.calls[1][1].result).toBe(savedBlob)
    expect(fetchMock).toHaveBeenCalledTimes(networkCount)
    expect(currentController.historySaved).toBe(true)
    expect(currentController.historyError).toBeUndefined()
  })
  it('四张中读取失败一张，其余先展示；同一任务版本重试不重新生成', async () => {
    const task: GenerationTask = { id: 'partial-read', capability: Capability.ImageEdit, params: { prompt: '白背景' }, status: 'processing', createdAt: '2026-09-30T12:00:00Z', updatedAt: '2026-09-30T12:00:00Z', creditsCost: 4 }
    mocks.createTask.mockResolvedValue(task)
    let failed = true
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url)
      const failedResult = failed && (target.endsWith('/1') || target.includes('partial/1.png') || target.includes(encodeURIComponent('generated/u/partial/1.png')))
      return failedResult
        ? new Response('', { status: 503 })
        : new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), { headers: { 'Content-Type': 'image/png' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    await act(async () => root.render(<ControllerHarness tool="smart-edit" prompt="白背景" count={4} onController={captureController} />))
    await act(async () => { await currentController.generate(null) })
    const completed: GenerationTask = { ...task, status: 'succeeded', updatedAt: '2026-09-30T12:01:00Z', resultUrls: [0, 1, 2, 3].map(i => `https://r2.test/${i}`), resultImages: [0, 1, 2, 3].map(ordinal => ({ objectKey: `generated/u/partial/${ordinal}.png`, url: `https://r2.test/${ordinal}`, expiresAt: Date.now() + 60_000, ordinal, width: 640, height: 480, mimeType: 'image/png' })) }
    mocks.polling.data = completed
    await act(async () => root.render(<ControllerHarness tool="smart-edit" prompt="白背景" count={4} onController={captureController} />))
    await vi.waitFor(async () => { await act(async () => {}); expect(currentController.readingResults).toBe(false); expect(currentController.outputAssets).toHaveLength(3) })
    const firstIds = currentController.outputAssets.map(asset => asset.id)
    failed = false
    await act(async () => { await currentController.retryRead() })
    expect(currentController.outputAssets).toHaveLength(4)
    expect(currentController.outputAssets.map(asset => asset.id)).toEqual(expect.arrayContaining(firstIds))
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith('https:'))).toHaveLength(0)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/objects'))).toHaveLength(5)
    expect(mocks.createTask).toHaveBeenCalledTimes(1)
    expect(currentController.resultReadError).toBeUndefined()
  })
  it('结果读取未完成时更换原图，迟到结果不更新页面', async () => {
    const task: GenerationTask = { id: 'late-read', capability: Capability.ImageEdit, params: {}, status: 'succeeded', createdAt: '2026-09-30T12:00:00Z', updatedAt: '2026-09-30T12:01:00Z', creditsCost: 1, resultUrls: ['late.png'] }
    mocks.createTask.mockResolvedValue(task)
    let finish!: () => void
    const fetchMock = vi.fn(async (url: string) => url === 'late.png' ? new Promise<Response>(resolve => { finish = () => resolve(new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), { headers: { 'Content-Type': 'image/png' } })) }) : new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), { headers: { 'Content-Type': 'image/png' } }))
    vi.stubGlobal('fetch', fetchMock)
    await act(async () => root.render(<ControllerHarness tool="smart-edit" prompt="白背景" onController={captureController} />))
    await act(async () => { await currentController.generate(null) })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await act(async () => { currentController.replaceSourceAsset({ ...initialAsset, id: 'new-source' }); finish() })
    await act(async () => {})
    expect(currentController.inputAsset?.id).toBe('new-source')
    expect(currentController.outputAssets).toEqual([])
    expect(mocks.historySave).not.toHaveBeenCalled()
  })

  it('准备原图时切换账号，中止读取且不向新账号提交旧请求', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))))
    vi.stubGlobal('fetch', fetchMock)
    await act(async () => root.render(<ControllerHarness tool="smart-edit" prompt="白背景" onController={captureController} />))
    let result!: Promise<unknown>
    await act(async () => { result = currentController.generate(null).catch(error => error) })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await act(async () => { useUserStore.getState().setUser('22222222-2222-4222-8222-222222222222', 'free'); await result })
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
    expect(mocks.uploadTaskInput).not.toHaveBeenCalled()
    expect(mocks.createTask).not.toHaveBeenCalled()
    expect(currentController.inputAsset).toBeUndefined()
    expect(currentController.submissionError).toBeUndefined()
  })

  const scene = { ...initialAsset, id: 'fusion-scene', url: 'scene.png' }
  const submittedFusion: GenerationTask = { id: 'fusion-task', capability: Capability.ImageEdit, params: {}, status: 'processing', creditsCost: 1, createdAt: '2026-10-02', updatedAt: '2026-10-02' }
  async function mountFusion(prompt = '原始描述', modelProfileId = 'original-model', selectedScene = scene) {
    await act(async () => root.render(<ControllerHarness tool="fusion" productAsset={initialAsset} referenceAsset={selectedScene} useProductAsset prompt={prompt} modelProfileId={modelProfileId} count={1} onController={captureController} />))
  }
  function deferredUploads() {
    let product!: (key: string) => void
    let reference!: (key: string) => void
    mocks.uploadTaskInput.mockImplementationOnce(() => new Promise(resolve => { product = resolve }))
      .mockImplementationOnce(() => new Promise(resolve => { reference = resolve }))
    return { product: (key = 'product-key') => product(key), reference: (key = 'scene-key') => reference(key) }
  }

  it('融合双图同时准备，场景先完成也保持对象身份；重复生成被拦截', async () => {
    const uploads = deferredUploads()
    mocks.createTask.mockResolvedValue(submittedFusion)
    await mountFusion()
    let generation!: Promise<unknown>
    await act(async () => { generation = currentController.generate(null) })
    await vi.waitFor(() => expect(mocks.uploadTaskInput).toHaveBeenCalledTimes(2))
    await expect(currentController.generate(null)).rejects.toThrow('等待当前提交')
    await act(async () => { uploads.reference() })
    expect(mocks.createTask).not.toHaveBeenCalled()
    await act(async () => { uploads.product(); await generation })
    expect(mocks.createTask).toHaveBeenCalledTimes(1)
    expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ sourceImageKey: 'product-key', referenceImageKey: 'scene-key' }) }))
    expect(useEditorStore.getState().project?.generations['generation:fusion-task'].inputAssetIds).toEqual([initialAsset.id, scene.id])
  })

  it('上传失败后只重传失败项，另一图未完成时不能重试；重试保留原参数', async () => {
    let finishProduct!: (key: string) => void
    mocks.uploadTaskInput.mockImplementationOnce(() => new Promise(resolve => { finishProduct = resolve }))
      .mockRejectedValueOnce(new Error('场景上传断开'))
    mocks.createTask.mockResolvedValue(submittedFusion)
    await mountFusion()
    let failed!: Promise<unknown>
    await act(async () => { failed = currentController.generate(null).catch(error => error) })
    await vi.waitFor(() => expect(currentController.inputPreparation?.reference.stage).toBe('failed'))
    expect(currentController.canRetryInputPreparation).toBe(false)
    await act(async () => { await currentController.retryInputPreparation() })
    expect(mocks.uploadTaskInput).toHaveBeenCalledTimes(2)
    await act(async () => { finishProduct('product-key'); await failed })
    expect(currentController.canRetryInputPreparation).toBe(true)
    expect(mocks.createTask).not.toHaveBeenCalled()
    await mountFusion('后来修改的描述', 'new-model')
    mocks.uploadTaskInput.mockResolvedValueOnce('scene-key')
    await act(async () => { await currentController.retryInputPreparation() })
    expect(mocks.uploadTaskInput).toHaveBeenCalledTimes(3)
    expect(mocks.createTask).toHaveBeenCalledTimes(1)
    expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({ modelProfileId: 'original-model', params: expect.objectContaining({ prompt: '原始描述', sourceImageKey: 'product-key', referenceImageKey: 'scene-key' }) }))
  })

  it('取消中止旧轮次且不提交，下一轮保留已经成功的商品上传', async () => {
    const uploads = deferredUploads()
    await mountFusion()
    let first!: Promise<unknown>
    await act(async () => { first = currentController.generate(null).catch(error => error) })
    await vi.waitFor(() => expect(mocks.uploadTaskInput).toHaveBeenCalledTimes(2))
    await act(async () => { uploads.product() })
    await act(async () => { currentController.cancelInputPreparation() })
    expect(currentController.inputPreparation?.phase).toBe('cancelled')
    expect(currentController.submitting).toBe(false)
    expect(mocks.uploadTaskInput.mock.calls[1][2]?.aborted).toBe(true)
    await act(async () => { uploads.reference(); await first })
    expect(mocks.createTask).not.toHaveBeenCalled()
    mocks.uploadTaskInput.mockResolvedValueOnce('new-scene-key')
    mocks.createTask.mockResolvedValue(submittedFusion)
    await act(async () => { await currentController.generate(null) })
    expect(mocks.uploadTaskInput).toHaveBeenCalledTimes(3)
    expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ sourceImageKey: 'product-key', referenceImageKey: 'new-scene-key' }) }))
  })

  it('准备期间换图或换工具，旧上传晚到不会提交旧任务', async () => {
    const uploads = deferredUploads()
    await mountFusion()
    let first!: Promise<unknown>
    await act(async () => { first = currentController.generate(null).catch(error => error) })
    await vi.waitFor(() => expect(mocks.uploadTaskInput).toHaveBeenCalledTimes(2))
    await mountFusion('新描述', 'original-model', { ...scene, id: 'replacement', url: 'replacement.png' })
    await act(async () => { uploads.product(); uploads.reference(); await first })
    expect(mocks.createTask).not.toHaveBeenCalled()
    expect(currentController.submissionError).toBeUndefined()
    await act(async () => root.render(<ControllerHarness tool="smart-edit" prompt="白背景" onController={captureController} referenceAsset={scene} />))
    mocks.createTask.mockResolvedValue({ ...submittedFusion, id: 'smart-task' })
    await act(async () => { await currentController.generate(null) })
    expect(mocks.createTask.mock.calls[0][0].params.referenceImageKey).toBeUndefined()
  })

  it('任务创建响应晚于账号切换，不登记旧账号生成记录', async () => {
    let finish!: (task: GenerationTask) => void
    mocks.createTask.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    await mountFusion()
    let first!: Promise<unknown>
    await act(async () => { first = currentController.generate(null).catch(error => error) })
    await vi.waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(1))
    await act(async () => {
      useUserStore.getState().setUser('22222222-2222-4222-8222-222222222222', 'free')
      finish(submittedFusion)
      await first
    })
    expect(currentController.activeTask).toBeUndefined()
    expect(useEditorStore.getState().project?.generations['generation:fusion-task']).toBeUndefined()
    expect(currentController.submissionError).toBeUndefined()
  })

  it('生成接口失败不提供输入重试，也不自动创建第二个任务', async () => {
    mocks.createTask.mockRejectedValue(new Error('提交响应中断'))
    await mountFusion()
    await act(async () => { await currentController.generate(null).catch(() => undefined) })
    expect(currentController.canRetryInputPreparation).toBe(false)
    expect(currentController.submissionError).toBe('提交响应中断')
    await act(async () => { await currentController.retryInputPreparation() })
    expect(mocks.createTask).toHaveBeenCalledTimes(1)
  })

})
