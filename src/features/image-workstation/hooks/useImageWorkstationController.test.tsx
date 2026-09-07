// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createImageAsset } from '@/editor/services/assetService'
import { useEditorStore } from '@/editor/store'
import { Capability, type GenerationTask, type InpaintTaskParams } from '@/types'
import { getWorkstationTool } from '../tools/registry'
import type { WorkstationCanvasHandle } from '../types'
import { useImageWorkstationController } from './useImageWorkstationController'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  polling: { data: undefined as GenerationTask<unknown> | undefined },
}))

vi.mock('@/services/api/task', () => ({ createTask: mocks.createTask }))
vi.mock('@/hooks/useTaskPolling', () => ({
  useTaskPolling: () => ({ data: mocks.polling.data }),
}))

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

function ControllerHarness({ tool = 'remove', onController }: { tool?: string; onController: (controller: Controller) => void }) {
  const controller = useImageWorkstationController({
    activeTool: getWorkstationTool(tool),
    initialAsset,
  })
  useEffect(() => onController(controller), [controller, onController])
  return null
}

describe('useImageWorkstationController 集成流程', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    mocks.createTask.mockReset()
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
    expect(currentController.inputAsset.id).toBe('asset:task-1:0')

    await act(async () => root.render(<ControllerHarness tool="repaint" onController={captureController} />))
    expect(currentController.inputAsset.id).toBe('asset:task-1:0')
    await act(async () => root.render(<ControllerHarness tool="outpaint" onController={captureController} />))
    expect(currentController.inputAsset.id).toBe('asset:task-1:0')
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
    expect(currentController.inputAsset.id).toBe('asset:task-2:0')
    expect(mocks.createTask).toHaveBeenNthCalledWith(2, expect.objectContaining({
      params: expect.objectContaining({ sourceImageUrl: 'first-result.png' }),
    }))
  })
})
