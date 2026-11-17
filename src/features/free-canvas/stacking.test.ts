import { describe, expect, it } from 'vitest'
import { cycleDown, pointInNode, stackAtPoint } from './stacking'

const base = {
  width: 100, height: 80, rotation: 0, visible: true,
}

describe('⌥ 点击穿透的命中栈', () => {
  it('点落在节点内/外', () => {
    const node = { ...base, id: 'a', x: 10, y: 20, zIndex: 0 }
    expect(pointInNode(node, { x: 10, y: 20 })).toBe(true)
    expect(pointInNode(node, { x: 110, y: 100 })).toBe(true)
    expect(pointInNode(node, { x: 9.5, y: 20 })).toBe(false)
    expect(pointInNode(node, { x: 60, y: 101 })).toBe(false)
  })

  it('旋转 90° 后按旋转后的矩形判断', () => {
    // 以左上角为轴顺时针转 90°：原 100×80 变成 x∈[-80,0]、y∈[0,100] 的竖条
    const node = { ...base, id: 'a', x: 0, y: 0, rotation: 90, zIndex: 0 }
    expect(pointInNode(node, { x: -40, y: 50 })).toBe(true)
    expect(pointInNode(node, { x: 40, y: 50 })).toBe(false)
  })

  it('命中栈按叠放顺序返回，跳过隐藏节点', () => {
    const nodes = [
      { ...base, id: 'bottom', x: 0, y: 0, zIndex: 0 },
      { ...base, id: 'top', x: 0, y: 0, zIndex: 2 },
      { ...base, id: 'middle', x: 0, y: 0, zIndex: 1 },
      { ...base, id: 'hidden', x: 0, y: 0, zIndex: 3, visible: false },
      { ...base, id: 'elsewhere', x: 500, y: 500, zIndex: 4 },
    ]
    expect(stackAtPoint(nodes, { x: 50, y: 40 })).toEqual(['top', 'middle', 'bottom'])
  })

  it('往下穿透并在底部回到顶层', () => {
    const stack = ['top', 'middle', 'bottom']
    expect(cycleDown(stack, 'top')).toBe('middle')
    expect(cycleDown(stack, 'middle')).toBe('bottom')
    expect(cycleDown(stack, 'bottom')).toBe('top')
  })

  it('当前选中不在栈里或没有选中时，从最顶层开始', () => {
    expect(cycleDown(['top', 'bottom'], undefined)).toBe('top')
    expect(cycleDown(['top', 'bottom'], 'other')).toBe('top')
  })

  it('空栈返回 undefined，单层原地循环', () => {
    expect(cycleDown([], 'a')).toBeUndefined()
    expect(cycleDown(['only'], 'only')).toBe('only')
  })
})
