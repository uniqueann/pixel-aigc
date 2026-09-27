import { describe, expect, it } from 'vitest'
import { ERASE_OVERLAY_HEIGHT, ERASE_OVERLAY_WIDTH, mapOverlayMaskToImage } from '../../../../shared/erase'
import { workstationCanvasDisplaySize } from './canvasDisplay'

describe('工作站画布窄屏显示', () => {
  it('390 宽容器把 640×420 收到满宽，逻辑蒙版仍按 640×420 映射', () => {
    const display = workstationCanvasDisplaySize(390)
    expect(display).toEqual({ width: 390, height: 256, scale: 390 / 640 })
    const overlay = new Uint8Array(ERASE_OVERLAY_WIDTH * ERASE_OVERLAY_HEIGHT)
    overlay[(80 * ERASE_OVERLAY_WIDTH) + 120] = 255
    const mapped = mapOverlayMaskToImage(
      overlay,
      ERASE_OVERLAY_WIDTH,
      ERASE_OVERLAY_HEIGHT,
      2000,
      1000,
    )
    expect(mapped.length).toBe(2000 * 1000)
    expect(mapped.some(value => value === 255)).toBe(true)
  })

  it('桌面容器不放大，超过 640 仍停在逻辑尺寸', () => {
    expect(workstationCanvasDisplaySize(800)).toEqual({
      width: 640,
      height: 420,
      scale: 1,
    })
  })

  it('375 与 360 窄屏按比例缩小高度', () => {
    expect(workstationCanvasDisplaySize(375).height).toBe(Math.round(ERASE_OVERLAY_HEIGHT * 375 / 640))
    expect(workstationCanvasDisplaySize(360).width).toBe(360)
    expect(workstationCanvasDisplaySize(360).scale).toBeCloseTo(360 / 640)
  })
})
