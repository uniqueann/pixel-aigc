import { beforeEach, describe, expect, it } from 'vitest'
import { AddNodeCommand, MoveNodeCommand, RemoveNodeCommand } from '@/editor/commands'
import { createImageAsset } from '@/editor/services/assetService'
import { useEditorStore } from './editorStore'
import type { ImageNode } from '@/editor/types'

const node: ImageNode = {
  id: 'node-1',
  type: 'image',
  assetId: 'asset-1',
  x: 0,
  y: 0,
  width: 100,
  height: 80,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  zIndex: 0,
}

describe('Editor Store', () => {
  beforeEach(() => {
    useEditorStore.getState().createProject('测试项目')
  })

  it('注册 Asset 并完成 Node CRUD', () => {
    const state = useEditorStore.getState()
    const sceneId = state.activeSceneId!
    const asset = createImageAsset({ id: 'asset-1', name: '图片', url: 'image.png', width: 100, height: 80 })
    state.registerAsset(asset)
    state.addNode(sceneId, node)
    state.updateNode(sceneId, node.id, { x: 20 })

    expect(useEditorStore.getState().project?.assets[asset.id]).toEqual(asset)
    expect(useEditorStore.getState().project?.document.scenes[0].nodes[0].x).toBe(20)

    state.removeNode(sceneId, node.id)
    expect(useEditorStore.getState().project?.document.scenes[0].nodes).toHaveLength(0)
    expect(useEditorStore.getState().project?.assets[asset.id]).toEqual(asset)
  })

  it('按命令粒度执行撤销和重做', () => {
    const state = useEditorStore.getState()
    const sceneId = state.activeSceneId!
    state.executeCommand(new AddNodeCommand(sceneId, node))
    state.executeCommand(new MoveNodeCommand(sceneId, node.id, { x: 40, y: 30 }))
    state.executeCommand(new RemoveNodeCommand(sceneId, node.id))

    state.undo()
    expect(useEditorStore.getState().project?.document.scenes[0].nodes[0]).toMatchObject({ x: 40, y: 30 })
    state.undo()
    expect(useEditorStore.getState().project?.document.scenes[0].nodes[0]).toMatchObject({ x: 0, y: 0 })
    state.redo()
    expect(useEditorStore.getState().project?.document.scenes[0].nodes[0]).toMatchObject({ x: 40, y: 30 })
    state.redo()
    expect(useEditorStore.getState().project?.document.scenes[0].nodes).toHaveLength(0)
  })
})
