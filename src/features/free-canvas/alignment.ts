import type { NodeBounds } from './geometry'

export type GuideAxis = 'x' | 'y'

export interface AlignmentGuide {
  axis: GuideAxis
  /** 参考线所在的画板坐标（X 轴是横坐标，Y 轴是纵坐标） */
  position: number
  /** 参考线在另一轴上的跨度 */
  start: number
  end: number
  /** 命中的另一轴位置标签，便于调试与测试 */
  edge: 'start' | 'center' | 'end'
}

type Edges = [start: number, center: number, end: number]

const EDGE_NAMES: AlignmentGuide['edge'][] = ['start', 'center', 'end']

function edgesX(bounds: NodeBounds): Edges {
  return [bounds.left, (bounds.left + bounds.right) / 2, bounds.right]
}

function edgesY(bounds: NodeBounds): Edges {
  return [bounds.top, (bounds.top + bounds.bottom) / 2, bounds.bottom]
}

/** 跨度合并用：同一条参考线覆盖所有对齐的节点。 */
function spanOf(bounds: NodeBounds, axis: GuideAxis): [number, number] {
  return axis === 'x' ? [bounds.top, bounds.bottom] : [bounds.left, bounds.right]
}

/**
 * 计算拖动中的包围盒与其它节点的对齐参考线。
 * - 不吸附：只产出线，坐标不会被改动；
 * - 每个轴最多三条（start / center / end 各取最近的一处命中）；
 * - 位置取**被参照节点**的边，跨度覆盖所有落在该位置上的节点。
 */
export function computeAlignmentGuides(
  moving: NodeBounds,
  others: NodeBounds[],
  threshold: number,
): AlignmentGuide[] {
  if (!others.length || threshold <= 0) return []
  const guides = new Map<string, AlignmentGuide>()

  const add = (guide: AlignmentGuide) => {
    const key = `${guide.axis}:${guide.position.toFixed(1)}`
    const existing = guides.get(key)
    if (!existing) {
      guides.set(key, guide)
      return
    }
    guides.set(key, {
      ...existing,
      start: Math.min(existing.start, guide.start),
      end: Math.max(existing.end, guide.end),
    })
  }

  for (const axis of ['x', 'y'] as const) {
    const movingEdges = axis === 'x' ? edgesX(moving) : edgesY(moving)
    const otherEdges = others.map((bounds) => axis === 'x' ? edgesX(bounds) : edgesY(bounds))

    movingEdges.forEach((movingEdge, edgeIndex) => {
      let best: { position: number; distance: number } | undefined
      for (const edges of otherEdges) {
        for (const value of edges) {
          const distance = Math.abs(movingEdge - value)
          if (distance > threshold) continue
          if (!best || distance < best.distance) best = { position: value, distance }
        }
      }
      if (!best) return

      // 跨度覆盖移动中的盒子 + 所有正好落在该位置上的节点。
      let [start, end] = spanOf(moving, axis)
      for (const [index, bounds] of others.entries()) {
        const edges = otherEdges[index]
        if (!edges.some((value) => Math.abs(value - best.position) < 0.5)) continue
        const [otherStart, otherEnd] = spanOf(bounds, axis)
        start = Math.min(start, otherStart)
        end = Math.max(end, otherEnd)
      }

      add({ axis, position: round(best.position), start: round(start), end: round(end), edge: EDGE_NAMES[edgeIndex] })
    })
  }

  return [...guides.values()].sort((a, b) => a.axis.localeCompare(b.axis) || a.position - b.position).slice(0, 6)
}

function round(value: number) {
  return Math.round(value * 2) / 2
}
