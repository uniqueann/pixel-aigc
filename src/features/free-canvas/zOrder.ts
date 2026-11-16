import type { EditorNode, NodeId } from '@/editor/types'

export type ZOrderAction = 'forward' | 'backward' | 'front' | 'back'

export interface ZOrderChange {
  id: NodeId
  zIndex: number
}

type ZOrderNode = Pick<EditorNode, 'id' | 'zIndex'>

/** 按 zIndex 升序的稳定顺序（同值保持原数组顺序），与画布渲染顺序一致。 */
export function sortedByZIndex<T extends ZOrderNode>(nodes: T[]): T[] {
  return nodes
    .map((node, index) => ({ node, index }))
    .sort((a, b) => a.node.zIndex - b.node.zIndex || a.index - b.index)
    .map((item) => item.node)
}

function moveForward(ids: NodeId[], selected: Set<NodeId>) {
  const next = [...ids]
  for (let index = next.length - 2; index >= 0; index -= 1) {
    if (!selected.has(next[index]) || selected.has(next[index + 1])) continue
    ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
  }
  return next
}

function moveBackward(ids: NodeId[], selected: Set<NodeId>) {
  const next = [...ids]
  for (let index = 1; index < next.length; index += 1) {
    if (!selected.has(next[index]) || selected.has(next[index - 1])) continue
    ;[next[index], next[index - 1]] = [next[index - 1], next[index]]
  }
  return next
}

/**
 * 计算层级调整后的 zIndex 分配：选中项整体同向移动，组内相对顺序不变，
 * 结果压缩为 0..n-1。返回 undefined 表示顺序未变，调用方不必产生命令。
 */
export function reorderZIndex(
  nodes: ZOrderNode[],
  selection: NodeId[],
  action: ZOrderAction,
): ZOrderChange[] | undefined {
  const selected = new Set(selection)
  const order = sortedByZIndex(nodes)
  const picked = order.filter((node) => selected.has(node.id))
  if (!picked.length) return undefined
  const rest = order.filter((node) => !selected.has(node.id))
  const ids = order.map((node) => node.id)
  const nextIds = action === 'front' ? [...rest, ...picked].map((node) => node.id)
    : action === 'back' ? [...picked, ...rest].map((node) => node.id)
      : action === 'forward' ? moveForward(ids, selected)
        : moveBackward(ids, selected)

  if (nextIds.every((id, index) => id === ids[index])) return undefined

  const changes: ZOrderChange[] = []
  const byId = new Map(nodes.map((node) => [node.id, node]))
  nextIds.forEach((id, index) => {
    const node = byId.get(id)
    if (!node || node.zIndex === index) return
    changes.push({ id, zIndex: index })
  })
  return changes.length ? changes : undefined
}

/** 新节点应当使用的层级：当前最大值 + 1。 */
export function nextZIndex(nodes: ZOrderNode[]): number {
  return nodes.reduce((max, node) => Math.max(max, node.zIndex), -1) + 1
}
