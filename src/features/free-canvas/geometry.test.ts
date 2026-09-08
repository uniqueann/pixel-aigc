import { describe, expect, it } from 'vitest'
import { createImageAsset } from '@/editor/services/assetService'
import {
  calculateFitViewport,
  calculateDerivedPlacements,
  calculateGenerationPlacements,
  calculateInitialImageNode,
  calculateNodeBounds,
  clampZoom,
  normalizeNodeTransform,
} from './geometry'

describe('自由画布几何计算', () => {
  it('在保留 64 像素边距的前提下将画板居中适配', () => {
    expect(calculateFitViewport(
      { width: 1000, height: 700 },
      { width: 1280, height: 720 },
    )).toEqual({
      zoom: 0.68125,
      panX: 64,
      panY: 104.75,
    })
  })

  it('限制缩放范围并规范化节点变换', () => {
    expect(clampZoom(0.01)).toBe(0.1)
    expect(clampZoom(8)).toBe(4)
    expect(normalizeNodeTransform({
      x: 10.126,
      y: -4.444,
      width: 12,
      height: 20,
      rotation: -45,
    })).toEqual({ x: 10.13, y: -4.44, width: 32, height: 32, rotation: 315 })
  })

  it('按画板 60% 范围等比放置初始图片且不放大源图', () => {
    const asset = createImageAsset({
      id: 'asset:test',
      name: '测试图片',
      url: 'test.png',
      width: 1280,
      height: 960,
    })
    const node = calculateInitialImageNode(asset, { id: 'scene:test', width: 1280, height: 720 })

    expect(node).toMatchObject({
      assetId: asset.id,
      x: 352,
      y: 144,
      width: 576,
      height: 432,
    })
  })

  it('将四个横向结果按 2×2 居中排列并限制最长边', () => {
    const placements = calculateGenerationPlacements(
      { x: 1000, y: 500 },
      { width: 1024, height: 768 },
      4,
    )

    expect(placements).toEqual([
      { x: 664, y: 244, width: 320, height: 240 },
      { x: 1016, y: 244, width: 320, height: 240 },
      { x: 664, y: 516, width: 320, height: 240 },
      { x: 1016, y: 516, width: 320, height: 240 },
    ])
  })

  it('将两个竖向结果放在同一行', () => {
    const placements = calculateGenerationPlacements(
      { x: 0, y: 0 },
      { width: 720, height: 1280 },
      2,
    )

    expect(placements).toEqual([
      { x: -196, y: -160, width: 180, height: 320 },
      { x: 16, y: -160, width: 180, height: 320 },
    ])
  })

  it('从旋转后源节点的右边缘开始排布派生结果', () => {
    const source = { x: 100, y: 50, width: 200, height: 100, rotation: 90 }
    expect(calculateNodeBounds(source)).toEqual({ left: 0, top: 50, right: 100, bottom: 250 })
    expect(calculateDerivedPlacements(source, 4)).toEqual([
      { x: 132, y: 50, width: 200, height: 100 },
      { x: 364, y: 50, width: 200, height: 100 },
      { x: 132, y: 182, width: 200, height: 100 },
      { x: 364, y: 182, width: 200, height: 100 },
    ])
  })
})
