import { beforeEach, describe, expect, it } from 'vitest'
import { useEditorStore } from '@/editor/store'
import type { ImageNode } from '@/editor/types'
import {
  AddNodeCommand,
  CompositeCommand,
  deserializeCommand,
  RemoveNodeCommand,
  UpdateNodeCommand,
} from './index'

function imageNode(id: string, x: number): ImageNode {
  return {
    id, type: 'image', assetId: `asset-${id}`, name: id,
    x, y: 10, width: 100, height: 80, rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0,
  }
}

describe('CompositeCommand', () => {
  beforeEach(() => {
    useEditorStore.getState().createProject('复合命令测试')
  })

  it('顺序执行、逆序回滚，一次撤销恢复全部节点', () => {
    const store = useEditorStore.getState()
    const sceneId = store.activeSceneId!
    useEditorStore.getState().addNode(sceneId, imageNode('a', 0))
    useEditorStore.getState().addNode(sceneId, imageNode('b', 0))

    const command = new CompositeCommand(sceneId, [
      new UpdateNodeCommand(sceneId, 'a', { x: 100 }),
      new UpdateNodeCommand(sceneId, 'b', { x: 200 }),
    ])
    useEditorStore.getState().executeCommand(command)

    const nodes = () => useEditorStore.getState().project!.document.scenes[0].nodes
    expect(nodes().map((node) => node.x)).toEqual([100, 200])
    expect(useEditorStore.getState().undoStack).toHaveLength(1)

    useEditorStore.getState().undo()
    expect(nodes().map((node) => node.x)).toEqual([0, 0])
    expect(useEditorStore.getState().redoStack).toHaveLength(1)

    useEditorStore.getState().redo()
    expect(nodes().map((node) => node.x)).toEqual([100, 200])
  })

  it('删除多条节点后一次撤销全部恢复', () => {
    const store = useEditorStore.getState()
    const sceneId = store.activeSceneId!
    useEditorStore.getState().addNode(sceneId, imageNode('a', 0))
    useEditorStore.getState().addNode(sceneId, imageNode('b', 0))

    useEditorStore.getState().executeCommand(new CompositeCommand(sceneId, [
      new RemoveNodeCommand(sceneId, 'a'),
      new RemoveNodeCommand(sceneId, 'b'),
    ]))
    expect(useEditorStore.getState().project!.document.scenes[0].nodes).toHaveLength(0)

    useEditorStore.getState().undo()
    // 逆序回滚会改变数组插入顺序，画布渲染依据 zIndex，这里只断言两条都被恢复。
    expect(useEditorStore.getState().project!.document.scenes[0].nodes.map((node) => node.id).sort()).toEqual(['a', 'b'])
  })

  it('预置 previous 的批量位移只产生一条撤销记录并回到起始位置', () => {
    const store = useEditorStore.getState()
    const sceneId = store.activeSceneId!
    const start = imageNode('a', 0)
    useEditorStore.getState().addNode(sceneId, start)

    // 模拟方向键：先直接改坐标（不写历史），停顿后提交一条命令。
    useEditorStore.getState().updateNode(sceneId, 'a', { x: 40 })
    useEditorStore.getState().updateNode(sceneId, 'a', { x: 60 })
    useEditorStore.getState().executeCommand(new UpdateNodeCommand(sceneId, 'a', { x: 60 }, start))

    expect(useEditorStore.getState().undoStack).toHaveLength(1)
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().project!.document.scenes[0].nodes[0].x).toBe(0)
  })

  it('序列化往返保持嵌套命令与撤销能力', () => {
    const store = useEditorStore.getState()
    const sceneId = store.activeSceneId!
    useEditorStore.getState().addNode(sceneId, imageNode('a', 0))

    const command = new CompositeCommand(sceneId, [
      new AddNodeCommand(sceneId, imageNode('b', 5)),
      new UpdateNodeCommand(sceneId, 'a', { x: 12 }),
    ])
    const serialized = command.serialize()
    const restored = deserializeCommand(serialized)

    expect(restored).toBeInstanceOf(CompositeCommand)
    expect(restored.serialize()).toEqual(serialized)

    useEditorStore.getState().executeCommand(restored)
    const nodes = useEditorStore.getState().project!.document.scenes[0].nodes
    expect(nodes.map((node) => node.id)).toEqual(['a', 'b'])
    expect(nodes[0].x).toBe(12)

    useEditorStore.getState().undo()
    expect(useEditorStore.getState().project!.document.scenes[0].nodes.map((node) => node.id)).toEqual(['a'])
    expect(useEditorStore.getState().project!.document.scenes[0].nodes[0].x).toBe(0)
  })
})
