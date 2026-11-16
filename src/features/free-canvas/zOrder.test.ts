import { describe, expect, it } from 'vitest'
import { nextZIndex, reorderZIndex, sortedByZIndex } from './zOrder'

const nodes = [
  { id: 'a', zIndex: 0 },
  { id: 'b', zIndex: 1 },
  { id: 'c', zIndex: 2 },
  { id: 'd', zIndex: 3 },
]

function apply(changes: { id: string; zIndex: number }[] | undefined) {
  if (!changes) return nodes.map((node) => node.id)
  const next = nodes.map((node) => ({ ...node }))
  for (const change of changes) {
    const target = next.find((node) => node.id === change.id)
    if (target) target.zIndex = change.zIndex
  }
  return sortedByZIndex(next).map((node) => node.id)
}

describe('zOrder', () => {
  it('按 zIndex 升序排列，同值保持原顺序', () => {
    expect(sortedByZIndex([{ id: 'x', zIndex: 2 }, { id: 'y', zIndex: 0 }, { id: 'z', zIndex: 2 }]).map((node) => node.id))
      .toEqual(['y', 'x', 'z'])
  })

  it('上移一层只跟上一层交换', () => {
    expect(apply(reorderZIndex(nodes, ['b'], 'forward'))).toEqual(['a', 'c', 'b', 'd'])
    expect(apply(reorderZIndex(nodes, ['d'], 'forward'))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('下移一层到下边界时不再移动', () => {
    expect(apply(reorderZIndex(nodes, ['c'], 'backward'))).toEqual(['a', 'c', 'b', 'd'])
    expect(apply(reorderZIndex(nodes, ['a'], 'backward'))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('置顶与置底保持组内相对顺序', () => {
    expect(apply(reorderZIndex(nodes, ['a', 'c'], 'front'))).toEqual(['b', 'd', 'a', 'c'])
    expect(apply(reorderZIndex(nodes, ['b', 'd'], 'back'))).toEqual(['b', 'd', 'a', 'c'])
  })

  it('顺序未变时返回 undefined，避免产生空命令', () => {
    expect(reorderZIndex(nodes, ['d'], 'front')).toBeUndefined()
    expect(reorderZIndex(nodes, ['a'], 'back')).toBeUndefined()
    expect(reorderZIndex(nodes, [], 'forward')).toBeUndefined()
  })

  it('层级有空洞时压缩为 0..n-1', () => {
    const sparse = [{ id: 'a', zIndex: 0 }, { id: 'b', zIndex: 7 }, { id: 'c', zIndex: 9 }]
    expect(reorderZIndex(sparse, ['b'], 'forward')).toEqual([
      { id: 'c', zIndex: 1 },
      { id: 'b', zIndex: 2 },
    ])
  })

  it('新节点层级取当前最大值 + 1', () => {
    expect(nextZIndex(nodes)).toBe(4)
    expect(nextZIndex([])).toBe(0)
  })
})
