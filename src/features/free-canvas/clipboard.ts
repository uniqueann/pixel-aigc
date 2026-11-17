import type { EditorNode, Scene } from '@/editor/types'
import { calculateNodeBounds, NODE_CASCADE_OFFSET, unionBounds } from './geometry'
import { nextZIndex } from './zOrder'

export interface CanvasClipboard {
  projectId: string
  nodes: EditorNode[]
}

/** 会话内剪贴板：只在同一项目内生效，避免把别的项目的节点粘到不存在的资产上。 */
let clipboard: CanvasClipboard | undefined
/** 记住上一次粘贴的锚点：同一位置连按 ⌘V 时按级联递增，不会完全叠在一起。 */
let lastPaste: { projectId: string; x: number; y: number; repeat: number } | undefined

function isCopyable(node: EditorNode) {
  return node.type === 'image' || node.type === 'video'
}

/** 复制节点到剪贴板，返回实际复制的数量（生成占位没有资产，不参与复制）。 */
export function copyNodesToClipboard(projectId: string, nodes: EditorNode[]): number {
  const copyable = nodes.filter(isCopyable)
  if (!copyable.length) return 0
  clipboard = { projectId, nodes: copyable.map((node) => ({ ...node })) }
  lastPaste = undefined
  return copyable.length
}

export function readClipboard(projectId: string): CanvasClipboard | undefined {
  return clipboard && clipboard.projectId === projectId ? clipboard : undefined
}

export function clearClipboard() {
  clipboard = undefined
  lastPaste = undefined
}

const round = (value: number) => Math.round(value * 100) / 100

interface PasteOptions {
  scene: Scene
  clipboard: CanvasClipboard
  /** 指针在画板坐标系的位置；有值时整组居中落在指针处 */
  pointer?: { x: number; y: number }
  createId?: () => string
}

/**
 * 把剪贴板内容变成一批待插入节点：
 * - 有指针时整组居中落在指针处，否则落在原位置 + 一级级联处；
 * - 在同一锚点重复粘贴时整组按 `NODE_CASCADE_OFFSET` 递增，保持组内相对布局；
 * - 不主动躲避画布上已有的节点（粘贴到指针处是明确意图，重叠由用户决定）。
 */
export function buildPastedNodes({ scene, clipboard: source, pointer, createId = () => crypto.randomUUID() }: PasteOptions): EditorNode[] {
  const nodes = [...source.nodes].sort((a, b) => a.zIndex - b.zIndex)
  if (!nodes.length) return []
  const sourceBounds = unionBounds(nodes.map((node) => calculateNodeBounds(node)))
  if (!sourceBounds) return []
  const width = sourceBounds.right - sourceBounds.left
  const height = sourceBounds.bottom - sourceBounds.top

  // 锚点是"整组中心"：有指针用指针，没指针用原位置 + 一级偏移。
  const anchor = pointer ?? {
    x: sourceBounds.left + width / 2 + NODE_CASCADE_OFFSET,
    y: sourceBounds.top + height / 2 + NODE_CASCADE_OFFSET,
  }
  const sameAnchor = lastPaste && lastPaste.projectId === source.projectId
    && Math.abs(lastPaste.x - anchor.x) < 1 && Math.abs(lastPaste.y - anchor.y) < 1
  const repeat = sameAnchor && lastPaste ? lastPaste.repeat + 1 : 0
  lastPaste = { projectId: source.projectId, x: anchor.x, y: anchor.y, repeat }
  const cascade = repeat * NODE_CASCADE_OFFSET
  const base = { x: anchor.x - width / 2 + cascade, y: anchor.y - height / 2 + cascade }

  const placements = nodes.map((node) => ({
    node,
    x: node.x - sourceBounds.left + base.x,
    y: node.y - sourceBounds.top + base.y,
  }))

  const zIndex = nextZIndex(scene.nodes)
  return placements.map(({ node, x, y }, index) => ({
    ...node,
    id: createId(),
    x: round(x),
    y: round(y),
    zIndex: zIndex + index,
  }))
}
