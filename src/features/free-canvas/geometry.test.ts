import { describe, expect, it } from 'vitest'
import { createImageAsset } from '@/editor/services/assetService'
import {
  calculateFitViewport,
  calculateDerivedPlacements,
  calculateGenerationPlacements,
  calculateInitialImageNode,
  calculateNodeBounds,
  calculateRevealViewport,
  clampZoom,
  normalizeNodeTransform,
  ARTBOARD_PLACEMENT_GAP,
  findArtboardPlacement,
  offsetPlacementToAvoidOverlap,
  overlapsBounds,
  boundsFromPlacement,
  placeArtboardNodes,
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

  it('画板放不下右侧结果时改到源图下方，并避开已有节点', () => {
    const source = { x: 900, y: 80, width: 300, height: 200, rotation: 0 }
    const placements = calculateDerivedPlacements(source, 1, {
      scene: { width: 1280, height: 720 },
      occupied: [{ left: 0, top: 300, right: 200, bottom: 500 }],
    })
    expect(placements[0].x + placements[0].width).toBeLessThanOrEqual(1280)
    expect(placements[0].y + placements[0].height).toBeLessThanOrEqual(720)
    expect(placements[0].y).toBeGreaterThanOrEqual(280)
  })

  it('新节点与已有节点中心重合时错开级联偏移', () => {
    const first = { x: 400, y: 200, width: 200, height: 160 }
    const occupied = { left: 400, top: 200, right: 600, bottom: 360 }
    const second = offsetPlacementToAvoidOverlap(first, [occupied])
    expect(second).toEqual({ x: 560, y: 360, width: 200, height: 160 })
    expect(overlapsBounds(boundsFromPlacement(second), occupied)).toBe(false)
  })

  it('优先把新节点放进画板，右侧和下方被占时改到左侧空位', () => {
    const placed = findArtboardPlacement(
      { x: 592, y: 200, width: 160, height: 120 },
      [
        { left: 560, top: 0, right: 1000, bottom: 600 },
        { left: 0, top: 340, right: 560, bottom: 600 },
      ],
      { width: 1000, height: 600 },
      { left: 400, top: 200, right: 560, bottom: 320 },
    )
    expect(placed.outside).toBe(false)
    expect(placed.x).toBeGreaterThanOrEqual(0)
    expect(placed.x + placed.width).toBeLessThanOrEqual(560)
    expect(placed.y).toBeGreaterThanOrEqual(0)
    expect(placed.y + placed.height).toBeLessThanOrEqual(340)
  })

  it('首选位置在画板下方时改放到画板内部', () => {
    const placed = findArtboardPlacement(
      { x: 400, y: 800, width: 180, height: 140 },
      [{ left: 500, top: 250, right: 780, bottom: 470 }],
      { width: 1280, height: 720 },
    )
    expect(placed.outside).toBe(false)
    expect(placed.x).toBeGreaterThanOrEqual(0)
    expect(placed.y).toBeGreaterThanOrEqual(0)
    expect(placed.x + placed.width).toBeLessThanOrEqual(1280)
    expect(placed.y + placed.height).toBeLessThanOrEqual(720)
  })

  it('画板只剩小空隙时先缩小，整板被占满才放到画板外', () => {
    const fitted = findArtboardPlacement(
      { x: 0, y: 0, width: 180, height: 140 },
      [{ left: 0, top: 0, right: 100, bottom: 160 }],
      { width: 200, height: 160 },
    )
    expect(fitted.outside).toBe(false)
    expect(fitted.width).toBeLessThan(180)
    expect(fitted.x).toBeGreaterThanOrEqual(0)
    expect(fitted.y).toBeGreaterThanOrEqual(0)
    expect(fitted.x + fitted.width).toBeLessThanOrEqual(200)
    expect(fitted.y + fitted.height).toBeLessThanOrEqual(160)

    const outside = findArtboardPlacement(
      { x: 10, y: 10, width: 80, height: 80 },
      [{ left: 0, top: 0, right: 200, bottom: 200 }],
      { width: 200, height: 200 },
    )
    expect(outside.outside).toBe(true)
    expect(outside.y).toBeGreaterThanOrEqual(200)
  })

  function expectInside(placement: { x: number; y: number; width: number; height: number }, scene: { width: number; height: number }) {
    expect(placement.x).toBeGreaterThanOrEqual(ARTBOARD_PLACEMENT_GAP)
    expect(placement.y).toBeGreaterThanOrEqual(ARTBOARD_PLACEMENT_GAP)
    expect(placement.x + placement.width).toBeLessThanOrEqual(scene.width - ARTBOARD_PLACEMENT_GAP)
    expect(placement.y + placement.height).toBeLessThanOrEqual(scene.height - ARTBOARD_PLACEMENT_GAP)
  }

  function expectClear(placement: { x: number; y: number; width: number; height: number }, occupied: { left: number; top: number; right: number; bottom: number }[]) {
    const bounds = boundsFromPlacement(placement)
    for (const item of occupied) expect(overlapsBounds(bounds, item, ARTBOARD_PLACEMENT_GAP)).toBe(false)
  }

  it('首选点越出上、左、右、下边缘时，整张节点收进画板并保留间距', () => {
    const scene = { width: 1280, height: 720 }
    const size = { width: 200, height: 120 }
    const edges = [
      { x: 400, y: -180 },
      { x: -220, y: 200 },
      { x: 1400, y: 200 },
      { x: 400, y: 900 },
    ]
    for (const origin of edges) {
      const placed = findArtboardPlacement({ ...origin, ...size }, [], scene)
      expect(placed.outside).toBe(false)
      expectInside(placed, scene)
      expect(placed.width).toBe(size.width)
      expect(placed.height).toBe(size.height)
    }
    expect(findArtboardPlacement({ x: 400, y: -180, ...size }, [], scene)).toMatchObject({ x: 400, y: ARTBOARD_PLACEMENT_GAP })
    expect(findArtboardPlacement({ x: -220, y: 200, ...size }, [], scene)).toMatchObject({ x: ARTBOARD_PLACEMENT_GAP, y: 200 })
    expect(findArtboardPlacement({ x: 1400, y: 200, ...size }, [], scene)).toMatchObject({
      x: scene.width - ARTBOARD_PLACEMENT_GAP - size.width,
      y: 200,
    })
    expect(findArtboardPlacement({ x: 400, y: 900, ...size }, [], scene)).toMatchObject({
      x: 400,
      y: scene.height - ARTBOARD_PLACEMENT_GAP - size.height,
    })
  })

  it('首选位置压住已有节点时改到最近的空位，不重叠也不伸出画板', () => {
    const scene = { width: 1280, height: 720 }
    const occupied = [{ left: 400, top: 200, right: 600, bottom: 360 }]
    const placed = findArtboardPlacement({ x: 400, y: 200, width: 200, height: 160 }, occupied, scene)
    expect(placed.outside).toBe(false)
    expect(placed.width).toBe(200)
    expect(placed.height).toBe(160)
    expectInside(placed, scene)
    expectClear(placed, occupied)
  })

  it('一批结果越出上沿时保持顺序和相对位置，且互不重叠', () => {
    const scene = { width: 1280, height: 720 }
    const preferred = [
      { x: 48, y: -40, width: 100, height: 80 },
      { x: 200, y: -40, width: 120, height: 80 },
      { x: 400, y: -40, width: 140, height: 80 },
    ]
    const placed = placeArtboardNodes(preferred, [], scene)
    expect(placed.map(item => item.width)).toEqual([100, 120, 140])
    expect(placed.every(item => item.y === ARTBOARD_PLACEMENT_GAP)).toBe(true)
    expect(placed.map(item => item.x)).toEqual([48, 200, 400])
    placed.forEach((item, index) => {
      expectInside(item, scene)
      expectClear(item, placed.filter((_, other) => other !== index).map(boundsFromPlacement))
    })
  })

  it('同一首选点的级联节点依次占住画板内互不重叠的空位', () => {
    const scene = { width: 1280, height: 720 }
    const preferred = Array.from({ length: 3 }, () => ({ x: 400, y: 200, width: 180, height: 140 }))
    const placed = placeArtboardNodes(preferred, [], scene)
    expect(placed).toHaveLength(3)
    placed.forEach((item, index) => {
      expectInside(item, scene)
      expectClear(item, placed.filter((_, other) => other !== index).map(boundsFromPlacement))
    })
    expect(new Set(placed.map(item => `${item.x},${item.y}`)).size).toBe(3)
  })

  it('画板被占满时放到画板外紧邻已有内容，且不与已有节点重叠', () => {
    const scene = { width: 200, height: 200 }
    const occupied = [{ left: 0, top: 0, right: 200, bottom: 200 }]
    const placed = findArtboardPlacement({ x: 10, y: 10, width: 80, height: 80 }, occupied, scene)
    expect(placed.outside).toBe(true)
    expect(placed.y).toBeGreaterThanOrEqual(scene.height)
    expect(overlapsBounds(boundsFromPlacement(placed), occupied[0])).toBe(false)
  })

  it('视口中心靠近画板上沿时，文生图结果完整落在画板内且不压住已有图片', () => {
    const scene = { width: 1280, height: 720 }
    const occupied = [
      { left: 40, top: 380, right: 420, bottom: 680 },
      { left: 860, top: 360, right: 1240, bottom: 690 },
    ]
    const preferred = calculateGenerationPlacements({ x: 640, y: 40 }, { width: 1024, height: 1024 }, 2)
    expect(preferred.some(item => item.y < 0)).toBe(true)
    const placed = placeArtboardNodes(preferred, occupied, scene)
    expect(placed).toHaveLength(2)
    placed.forEach((item, index) => {
      expect(item.x).toBeGreaterThanOrEqual(16)
      expect(item.y).toBeGreaterThanOrEqual(16)
      expect(item.x + item.width).toBeLessThanOrEqual(scene.width - 16)
      expect(item.y + item.height).toBeLessThanOrEqual(scene.height - 16)
      expectClear(item, occupied)
      expectClear(item, placed.filter((_, other) => other !== index).map(boundsFromPlacement))
    })
  })

  it('结果超出当前视口时平移以完整显示目标区域', () => {
    expect(calculateRevealViewport(
      { width: 800, height: 600 },
      [{ left: 1200, top: 80, right: 1520, bottom: 320 }],
      { zoom: 0.5, panX: 64, panY: 100 },
    )).toMatchObject({
      zoom: 0.5,
      panX: expect.any(Number),
      panY: expect.any(Number),
    })
    const revealed = calculateRevealViewport(
      { width: 800, height: 600 },
      [{ left: 1200, top: 80, right: 1520, bottom: 320 }],
      { zoom: 0.5, panX: 64, panY: 100 },
    )
    expect(revealed.panX + 1200 * revealed.zoom).toBeGreaterThan(0)
    expect((64 - revealed.panX) / revealed.zoom).toBeLessThan(1200)
  })
})
