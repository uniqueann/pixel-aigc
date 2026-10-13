import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoveNodeCommand } from '@/editor/commands'
import { generationIdForTask } from '@/editor/adapters/taskAdapter'
import { recoveryForTask, usePersistenceStore } from '@/editor/persistence/persistenceStore'
import { useEditorStore } from '@/editor/store'
import type { GenerationNode } from '@/editor/types'
import { Capability } from '@/types'
import { buildTextToImageRequest } from '@/features/free-canvas/generation/requestBuilder'
import { IMAGE_SIZE_PRESETS } from '@/features/free-canvas/generation/config'

const pageSource = readFileSync(resolve(process.cwd(), 'src/pages/FreeCanvas/index.tsx'), 'utf8')
const stageSource = readFileSync(resolve(process.cwd(), 'src/features/free-canvas/FreeCanvasStage.tsx'), 'utf8')

describe('失败生成占位卡片删除与清理', () => {
  beforeEach(() => {
    useEditorStore.getState().createProject('测试项目')
    usePersistenceStore.setState({ recoveries: {} })
  })

  it('源码契约：FreeCanvasStage 允许删除失败或已取消的占位，生成中占位保持锁定', () => {
    expect(stageSource).toContain("(selectedGenerationStatus === 'failed' || selectedGenerationStatus === 'cancelled')")
    expect(stageSource).toContain('canDeleteSelected = !!selectedNode && (selectedNode.type !== \'generation\' || isSelectedTerminalGeneration)')
    expect(stageSource).toContain('删除占位框')
    expect(stageSource).toContain('生成中的占位框暂不支持删除')
  })

  it('源码契约：FreeCanvas/index.tsx handleDelete 允许删除终态生成节点并收敛 recovery 和 task', () => {
    expect(pageSource).toContain("const isTerminal = job?.status && (job.status === 'failed' || job.status === 'cancelled')")
    expect(pageSource).toContain('usePersistenceStore.getState().setRecovery({ ...rec, abandoned: true })')
    expect(pageSource).toContain('generation.dismissTask()')
  })

  it('进行中的生成占位节点阻止删除，终态失败的生成占位节点允许删除并标记 abandoned', () => {
    const state = useEditorStore.getState()
    const sceneId = state.activeSceneId!

    const activeTaskId = 'task-active-1'
    const activeGenId = generationIdForTask(activeTaskId)
    const activeNode: GenerationNode = {
      id: `generation-node:${activeTaskId}:0`,
      type: 'generation',
      generationId: activeGenId,
      resultIndex: 0,
      name: '生成占位 1',
      x: 100,
      y: 100,
      width: 320,
      height: 320,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 1,
    }
    state.registerGeneration({
      id: activeGenId,
      capability: Capability.TextToImage,
      status: 'processing',
      input: {},
      inputAssetIds: [],
      outputAssetIds: [],
      backendTaskId: activeTaskId,
      createdAt: '2026-10-12T00:00:00Z',
      updatedAt: '2026-10-12T00:00:00Z',
    })
    state.addNode(sceneId, activeNode)

    const request = buildTextToImageRequest('测试任务', IMAGE_SIZE_PRESETS[0], 1)
    usePersistenceStore.getState().setRecovery({
      projectId: state.project!.id,
      sceneId,
      request,
      context: { inputAssetIds: [], autoRetryRemaining: 0, automaticRetry: false },
      placements: [{ x: 100, y: 100, width: 320, height: 320 }],
      replacedPlaceholderIds: [],
      backendTaskId: activeTaskId,
      applied: false,
    })

    const dismissTask = vi.fn()

    // 模拟 handleDelete 对进行中任务的处理
    const tryDelete = (nodeId: string) => {
      const currentState = useEditorStore.getState()
      const currentScene = currentState.project?.document.scenes.find((item) => item.id === currentState.activeSceneId)
      const targetNode = currentScene?.nodes.find((node) => node.id === nodeId)
      if (!targetNode) return
      if (targetNode.type === 'generation') {
        const job = currentState.project?.generations[targetNode.generationId]
        const isTerminal = job?.status && ['failed', 'cancelled', 'expired'].includes(job.status)
        if (!isTerminal) return
        for (const rec of Object.values(usePersistenceStore.getState().recoveries)) {
          if (rec.abandoned || rec.applied) continue
          if ((rec.backendTaskId && generationIdForTask(rec.backendTaskId) === targetNode.generationId)
              || (job?.backendTaskId && rec.backendTaskId === job.backendTaskId)) {
            usePersistenceStore.getState().setRecovery({ ...rec, abandoned: true })
          }
        }
        dismissTask()
      }
      currentState.executeCommand(new RemoveNodeCommand(currentState.activeSceneId!, nodeId))
    }

    // 1. 进行中节点：删除被拦截
    tryDelete(activeNode.id)
    expect(useEditorStore.getState().project?.document.scenes[0].nodes).toHaveLength(1)
    expect(recoveryForTask(activeTaskId)?.abandoned).toBeUndefined()
    expect(dismissTask).not.toHaveBeenCalled()

    // 2. 将状态更新为 failed：允许删除
    state.registerGeneration({
      id: activeGenId,
      capability: Capability.TextToImage,
      status: 'failed',
      input: {},
      inputAssetIds: [],
      outputAssetIds: [],
      backendTaskId: activeTaskId,
      createdAt: '2026-10-12T00:00:00Z',
      updatedAt: '2026-10-12T00:01:00Z',
    })

    tryDelete(activeNode.id)
    expect(useEditorStore.getState().project?.document.scenes[0].nodes).toHaveLength(0)
    expect(recoveryForTask(activeTaskId)?.abandoned).toBe(true)
    expect(dismissTask).toHaveBeenCalledOnce()
  })
})
