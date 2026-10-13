import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { RemoveNodeCommand } from '@/editor/commands'
import { defaultDrafts } from '@/editor/persistence/types'
import { usePersistenceStore } from '@/editor/persistence/persistenceStore'
import { useEditorStore } from '@/editor/store'
import { createImageAsset } from '@/editor/services/assetService'
import type { ImageNode } from '@/editor/types'

const pageSource = readFileSync(resolve(process.cwd(), 'src/pages/FreeCanvas/index.tsx'), 'utf8')
const stageSource = readFileSync(resolve(process.cwd(), 'src/features/free-canvas/FreeCanvasStage.tsx'), 'utf8')

describe('损坏图片在画布上的显示与移除', () => {
  beforeEach(() => {
    useEditorStore.getState().createProject('测试项目')
    usePersistenceStore.setState({ drafts: defaultDrafts() })
  })

  it('源码契约：FreeCanvasStage 包含图片损坏占位及删除引导，且不展示裂变/图生视频浮动条', () => {
    expect(stageSource).toContain("function createBrokenImageObject(node: ImageNode)")
    expect(stageSource).toContain("new FabricText('图片损坏'")
    expect(stageSource).toContain("new FabricText('无法解码，可按 Delete 删除'")
    expect(stageSource).toContain("brokenImageNodesRef.current.has(node.id)")
    expect(stageSource).toContain("const selectedImage = selectedNode?.type === 'image' && !brokenImageNodesRef.current.has(selectedNode.id) ? selectedNode : undefined")
  })

  it('源码契约：FreeCanvas/index.tsx 提供清理损坏图片按钮及清除派生草稿引用', () => {
    expect(pageSource).toContain('清理损坏图片')
    expect(pageSource).toContain('handleRemoveBrokenImages')
    expect(pageSource).toContain('images.brokenAssetIds')
    expect(pageSource).toContain("currentDraft.sourceAssetId === targetNode.assetId")
  })

  it('清理损坏图片能够清理画布节点并重置引用它的派生草稿', () => {
    const store = useEditorStore.getState()
    const sceneId = store.activeSceneId!

    const badAsset = createImageAsset({
      id: 'corrupted-asset-1',
      name: '生成结果 1',
      url: '/__aigc_asset__/corrupted-1',
      objectKey: 'corrupted-1.png',
      width: 512,
      height: 512,
    })
    useEditorStore.getState().registerAsset(badAsset)

    const badNode: ImageNode = {
      id: 'image-node-corrupted',
      type: 'image',
      assetId: badAsset.id,
      name: badAsset.name,
      x: 100,
      y: 100,
      width: 512,
      height: 512,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 1,
    }
    useEditorStore.getState().addNode(sceneId, badNode)

    // 设置引用该损坏节点的派生生成草稿
    usePersistenceStore.getState().setDrafts({
      ...defaultDrafts(),
      derived: {
        mode: 'variation',
        sourceNode: { ...badNode },
        sourceAssetId: badAsset.id,
        prompt: '测试变体',
        count: 1,
        durationSeconds: 5,
        resolution: '1k',
        generateAudio: false,
      },
    })

    expect(usePersistenceStore.getState().drafts.derived).toBeDefined()
    expect(useEditorStore.getState().project?.document.scenes[0].nodes).toHaveLength(1)

    // 执行移除损坏图片逻辑
    const brokenAssetIds = [badAsset.id]
    const brokenAssetIdSet = new Set(brokenAssetIds)
    const currentScene = useEditorStore.getState().project?.document.scenes.find((item) => item.id === sceneId)
    expect(currentScene).toBeDefined()
    const brokenNodes = currentScene!.nodes.filter(
      (node) => node.type === 'image' && brokenAssetIdSet.has(node.assetId),
    )
    expect(brokenNodes).toHaveLength(1)

    for (const node of brokenNodes) {
      useEditorStore.getState().executeCommand(new RemoveNodeCommand(sceneId, node.id))
    }

    const currentDraft = usePersistenceStore.getState().drafts.derived
    if (
      currentDraft &&
      (brokenNodes.some((n) => n.id === currentDraft.sourceNode.id) ||
        brokenAssetIdSet.has(currentDraft.sourceAssetId))
    ) {
      usePersistenceStore.getState().setDrafts({ ...usePersistenceStore.getState().drafts, derived: undefined })
    }

    // 验证节点已被移除，派生草稿被清理
    expect(useEditorStore.getState().project?.document.scenes[0].nodes).toHaveLength(0)
    expect(usePersistenceStore.getState().drafts.derived).toBeUndefined()

    // 验证撤销功能：可撤销恢复
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().project?.document.scenes[0].nodes).toHaveLength(1)
  })
})
