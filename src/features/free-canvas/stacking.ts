import type { EditorNode, NodeId } from '@/editor/types'

export interface StackPoint {
  x: number
  y: number
}

type StackNode = Pick<EditorNode, 'id' | 'x' | 'y' | 'width' | 'height' | 'rotation' | 'visible' | 'zIndex'>

/**
 * 点是否落在节点内。节点的 `angle` 围绕左上角旋转（与 `calculateNodeBounds` 同一假设），
 * 所以这里把点反向旋转回节点本地坐标再比较。
 */
export function pointInNode(node: StackNode, point: StackPoint): boolean {
  const radians = (-node.rotation * Math.PI) / 180
  const dx = point.x - node.x
  const dy = point.y - node.y
  const localX = dx * Math.cos(radians) - dy * Math.sin(radians)
  const localY = dx * Math.sin(radians) + dy * Math.cos(radians)
  return localX >= 0 && localY >= 0 && localX <= node.width && localY <= node.height
}

/** 该点命中的节点，**顶层在前**（与画布叠放顺序一致），跳过隐藏节点。 */
export function stackAtPoint(nodes: StackNode[], point: StackPoint): NodeId[] {
  return nodes
    .filter((node) => node.visible && pointInNode(node, point))
    .slice()
    .sort((a, b) => b.zIndex - a.zIndex)
    .map((node) => node.id)
}

/**
 * 在命中栈里往下走一步（顶层是 0），到底后回到顶层。
 * 当前选中项不在栈里时返回最顶层，符合"⌥ 点击开始穿透"的预期。
 */
export function cycleDown(stack: NodeId[], current?: NodeId): NodeId | undefined {
  if (!stack.length) return undefined
  const index = current ? stack.indexOf(current) : -1
  if (index < 0) return stack[0]
  return stack[(index + 1) % stack.length]
}
