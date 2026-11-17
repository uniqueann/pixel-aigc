import { describe, expect, it } from 'vitest'
import { computeAlignmentGuides } from './alignment'
import type { NodeBounds } from './geometry'

const box = (left: number, top: number, width: number, height: number): NodeBounds => ({
  left, top, right: left + width, bottom: top + height,
})

const THRESHOLD = 4

describe('对齐参考线', () => {
  it('左边缘接近时出竖线，位置取被参照节点', () => {
    const guides = computeAlignmentGuides(box(102, 200, 100, 80), [box(100, 0, 50, 50)], THRESHOLD)
    expect(guides).toContainEqual({ axis: 'x', position: 100, start: 0, end: 280, edge: 'start' })
  })

  it('不同类别也能对齐：拖动方中心压在对方右边缘上', () => {
    // 拖动盒中心 152，参照盒右边缘 150，差 2px
    const guides = computeAlignmentGuides(box(102, 200, 100, 80), [box(100, 0, 50, 50)], THRESHOLD)
    expect(guides).toContainEqual({ axis: 'x', position: 150, start: 0, end: 280, edge: 'center' })
  })

  it('超出阈值就不出线', () => {
    expect(computeAlignmentGuides(box(120, 200, 100, 80), [box(100, 0, 50, 50)], THRESHOLD)).toEqual([])
  })

  it('纵向（上中下）对齐也能识别', () => {
    // 拖动盒纵向中心 50，参照盒顶边 52，差 2px
    const guides = computeAlignmentGuides(box(0, 0, 100, 100), [box(300, 52, 100, 100)], THRESHOLD)
    expect(guides).toContainEqual({ axis: 'y', position: 52, start: 0, end: 400, edge: 'center' })
  })

  it('跨度覆盖所有落在同一条线上的节点', () => {
    const guides = computeAlignmentGuides(
      box(100, 500, 100, 100),
      [box(100, 0, 50, 50), box(100, 300, 50, 50)],
      THRESHOLD,
    )
    expect(guides).toContainEqual({ axis: 'x', position: 100, start: 0, end: 600, edge: 'start' })
  })

  it('同一位置的多条命中合并成一条，不重复画', () => {
    const guides = computeAlignmentGuides(
      box(100, 200, 100, 100),
      [box(100, 0, 50, 50), box(100, 90, 50, 50)],
      THRESHOLD,
    )
    const positions = guides.map((guide) => `${guide.axis}:${guide.position}`)
    expect(new Set(positions).size).toBe(positions.length)
    expect(guides).toContainEqual({ axis: 'x', position: 100, start: 0, end: 300, edge: 'start' })
  })

  it('每个轴最多三条（起点/中心/终点各一处）', () => {
    const others = [box(100, 0, 50, 50), box(150, 100, 50, 50), box(200, 200, 50, 50)]
    const guides = computeAlignmentGuides(box(100, 300, 100, 50), others, THRESHOLD)
    expect(guides.filter((guide) => guide.axis === 'x')).toHaveLength(3)
  })

  it('没有其它节点或阈值非正时不出线', () => {
    expect(computeAlignmentGuides(box(0, 0, 10, 10), [], THRESHOLD)).toEqual([])
    expect(computeAlignmentGuides(box(0, 0, 10, 10), [box(0, 0, 10, 10)], 0)).toEqual([])
  })
})
