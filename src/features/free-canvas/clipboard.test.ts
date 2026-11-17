import { beforeEach, describe, expect, it } from 'vitest'
import type { EditorNode, Scene } from '@/editor/types'
import { NODE_CASCADE_OFFSET } from './geometry'
import { buildPastedNodes, clearClipboard, copyNodesToClipboard, readClipboard, type CanvasClipboard } from './clipboard'

function imageNode(id: string, x: number, y: number, zIndex = 0): EditorNode {
  return {
    id, type: 'image', assetId: `asset-${id}`, name: id,
    x, y, width: 100, height: 80, rotation: 0, opacity: 1, visible: true, locked: false, zIndex,
  }
}

function generationNode(id: string): EditorNode {
  return {
    id, type: 'generation', generationId: 'gen-1', name: id,
    x: 0, y: 0, width: 320, height: 320, rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0,
  }
}

function scene(nodes: EditorNode[]): Scene {
  return { id: 'scene-1', name: '场景 1', width: 1280, height: 720, nodes, viewport: { zoom: 1, panX: 0, panY: 0 } }
}

function clipboardOf(...nodes: EditorNode[]): CanvasClipboard {
  return { projectId: 'project-1', nodes }
}

describe('画布剪贴板', () => {
  beforeEach(() => { clearClipboard() })

  it('只复制图片与视频，生成占位不参与', () => {
    expect(copyNodesToClipboard('project-1', [imageNode('a', 0, 0), generationNode('g')])).toBe(1)
    expect(readClipboard('project-1')?.nodes.map((node) => node.id)).toEqual(['a'])
  })

  it('剪贴板绑定项目，换项目读不到', () => {
    copyNodesToClipboard('project-1', [imageNode('a', 0, 0)])
    expect(readClipboard('project-1')).toBeTruthy()
    expect(readClipboard('project-2')).toBeUndefined()
  })

  it('没有可复制内容时不覆盖已有剪贴板', () => {
    copyNodesToClipboard('project-1', [imageNode('a', 0, 0)])
    expect(copyNodesToClipboard('project-1', [generationNode('g')])).toBe(0)
    expect(readClipboard('project-1')?.nodes).toHaveLength(1)
  })

  it('有指针时整组居中落在指针处，并保持相对布局', () => {
    const nodes = [imageNode('a', 0, 0), imageNode('b', 300, 200)]
    const pasted = buildPastedNodes({
      scene: scene([]),
      clipboard: clipboardOf(...nodes),
      pointer: { x: 640, y: 360 },
      createId: (() => { let index = 0; return () => `paste-${++index}` })(),
    })
    expect(pasted.map((node) => node.id)).toEqual(['paste-1', 'paste-2'])
    // 组包围盒：x 0..400 (100+300), y 0..280 (80+200) → 居中后左上角 (440, 220)
    expect(pasted.map((node) => [node.x, node.y])).toEqual([[440, 220], [740, 420]])
    // 相对布局不变
    expect(pasted[1].x - pasted[0].x).toBe(300)
    expect(pasted[1].y - pasted[0].y).toBe(200)
  })

  it('没有指针时在原位置基础上级联偏移', () => {
    const pasted = buildPastedNodes({ scene: scene([]), clipboard: clipboardOf(imageNode('a', 100, 100)) })
    const expected = 100 + NODE_CASCADE_OFFSET
    expect([pasted[0].x, pasted[0].y]).toEqual([expected, expected])
  })

  it('同一指针位置连续粘贴时按级联递增，不会完全叠住', () => {
    const clipboard = clipboardOf(imageNode('a', 100, 100))
    const first = buildPastedNodes({ scene: scene([]), clipboard, pointer: { x: 640, y: 360 } })
    const second = buildPastedNodes({ scene: scene([]), clipboard, pointer: { x: 640, y: 360 } })
    const third = buildPastedNodes({ scene: scene([]), clipboard, pointer: { x: 640, y: 360 } })
    expect([first[0].x, second[0].x, third[0].x]).toEqual([
      640 - 50,
      640 - 50 + NODE_CASCADE_OFFSET,
      640 - 50 + NODE_CASCADE_OFFSET * 2,
    ])
  })

  it('换一个指针位置粘贴不级联，重新落在指针中心', () => {
    const clipboard = clipboardOf(imageNode('a', 100, 100))
    buildPastedNodes({ scene: scene([]), clipboard, pointer: { x: 640, y: 360 } })
    const moved = buildPastedNodes({ scene: scene([]), clipboard, pointer: { x: 320, y: 200 } })
    expect([moved[0].x, moved[0].y]).toEqual([320 - 50, 200 - 40])
  })

  it('粘贴不躲避现有节点：落在指针处就是用户的意图', () => {
    const existing = imageNode('old', 100, 100)
    const pasted = buildPastedNodes({
      scene: scene([existing]),
      clipboard: clipboardOf(imageNode('a', 100, 100)),
      pointer: { x: 150, y: 140 },
    })
    expect([pasted[0].x, pasted[0].y]).toEqual([100, 100])
  })

  it('粘贴出来的节点层级压在现有内容之上，并保持组内顺序', () => {
    const pasted = buildPastedNodes({
      scene: scene([imageNode('old', 500, 500, 7)]),
      clipboard: clipboardOf(imageNode('a', 0, 0, 3), imageNode('b', 200, 0, 1)),
    })
    expect(pasted.map((node) => node.id)).toHaveLength(2)
    // 按原 zIndex 升序重排：b(1) 在前，a(3) 在后
    expect(pasted.map((node) => node.name)).toEqual(['b', 'a'])
    expect(pasted.map((node) => node.zIndex)).toEqual([8, 9])
  })

  it('空剪贴板返回空数组', () => {
    expect(buildPastedNodes({ scene: scene([]), clipboard: clipboardOf() })).toEqual([])
  })
})
