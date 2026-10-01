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

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  liveCapabilityReady: vi.fn(() => true),
  uploadDataUrl: vi.fn(async (url: string) => url),
  uploadTaskInput: vi.fn(async () => 'temporary/task-inputs/user/source-1'),
  requestErase: vi.fn(),
  requestRepaint: vi.fn(),
  requestOutpaint: vi.fn(),
  polling: { data: undefined as GenerationTask<unknown> | undefined },
}))

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
    mocks.createTask.mockReset()
    mocks.liveCapabilityReady.mockReset()
    mocks.liveCapabilityReady.mockReturnValue(true)
    mocks.uploadDataUrl.mockReset()
    mocks.uploadDataUrl.mockImplementation(async (url: string) => url)
    mocks.uploadTaskInput.mockReset()
    mocks.uploadTaskInput.mockResolvedValue('temporary/task-inputs/user/source-1')
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 640, height: 480, close: vi.fn() })))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }))))
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

    const secondGeneration = useEditorStore.getState().project?.generations['generation:task-2']
    expect(secondGeneration).toMatchObject({
      status: 'succeeded',
      inputAssetIds: ['asset:task-1:0'],
      outputAssetIds: ['asset:task-2:0'],
      parentGenerationId: 'generation:task-1',
    })
    expect(currentController.inputAsset?.id).toBe('asset:task-2:0')
    expect(mocks.createTask).toHaveBeenNthCalledWith(2, expect.objectContaining({
      params: expect.objectContaining({ sourceImageUrl: 'first-result.png' }),
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

    expect(currentController.outputAssets.map((asset) => asset.url)).toEqual(['candidate-1.png', 'candidate-2.png'])
    await act(async () => currentController.selectOutput('asset:task-smart-edit:1'))
    expect(currentController.inputAsset?.url).toBe('candidate-2.png')
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
    vi.mocked(createImageBitmap).mockResolvedValue({ width: 960, height: 480, close: vi.fn() } as unknown as ImageBitmap)
    await act(async () => { await currentController.generate({ ...canvas, getTargetSize: () => ({ width: 960, height: 480 }) }) })
    expect(mocks.requestOutpaint).toHaveBeenLastCalledWith(expect.any(Blob), 'image/jpeg', { left: 80, right: 80, top: 0, bottom: 0 }, undefined)
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
    expect(currentController.outputAssets.map((asset) => asset.url)).toEqual(['candidate-only.png'])
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
})
