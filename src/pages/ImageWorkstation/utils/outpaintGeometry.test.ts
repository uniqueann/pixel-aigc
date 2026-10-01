import { describe, expect, it } from 'vitest'
import { PLATFORM_SIZE_PRESETS } from '@/constants/platformSizes'
import { planBailianOutpaint, paddingAround } from '../../../../shared/outpaint'
import {
  freeOutpaintGeometry,
  modelSizeFromDisplay,
  outpaintDisplayScale,
  presetOutpaintGeometry,
} from './outpaintGeometry'

const SOURCE = { width: 2048, height: 1365 }

describe('工作站扩图几何', () => {
  it('保留分辨率时大图扩成 5035 方图，主体区域仍为 3200×5035', () => {
    const geo = presetOutpaintGeometry(3200, 5035, 1600, 1600, 'original')
    expect(geo).toEqual({
      targetSize: { width: 5035, height: 5035 },
      sourceSize: { width: 3200, height: 5035 },
      originOffset: { x: 917, y: 0 },
    })
    const padding = paddingAround(3200, 5035, 917, 0, 5035, 5035)
    const plan = planBailianOutpaint(3200, 5035, padding)
    expect(plan.inputHeight).toBe(4096)
    expect(plan.targetWidth).toBe(5035)
    expect(plan.targetHeight).toBe(5035)
  })

  it.each(PLATFORM_SIZE_PRESETS.map(preset => [preset.id, preset.width, preset.height] as const))(
    '%s 对 2048×1365 输出精确 preset 尺寸，并 contain 居中',
    (_id, presetWidth, presetHeight) => {
      const geo = presetOutpaintGeometry(SOURCE.width, SOURCE.height, presetWidth, presetHeight)
      expect(geo.targetSize).toEqual({ width: presetWidth, height: presetHeight })
      expect(geo.sourceSize.width).toBeLessThanOrEqual(presetWidth)
      expect(geo.sourceSize.height).toBeLessThanOrEqual(presetHeight)
      expect(geo.originOffset.x + geo.sourceSize.width).toBeLessThanOrEqual(presetWidth)
      expect(geo.originOffset.y + geo.sourceSize.height).toBeLessThanOrEqual(presetHeight)
      const padding = paddingAround(
        geo.sourceSize.width,
        geo.sourceSize.height,
        geo.originOffset.x,
        geo.originOffset.y,
        geo.targetSize.width,
        geo.targetSize.height,
      )
      const plan = planBailianOutpaint(geo.sourceSize.width, geo.sourceSize.height, padding)
      expect(plan.targetWidth).toBe(presetWidth)
      expect(plan.targetHeight).toBe(presetHeight)
    },
  )

  it('Amazon 1600×1600 会把 2048×1365 缩成 1600×1066 再只补上下', () => {
    const geo = presetOutpaintGeometry(2048, 1365, 1600, 1600)
    expect(geo).toEqual({
      targetSize: { width: 1600, height: 1600 },
      sourceSize: { width: 1600, height: 1066 },
      originOffset: { x: 0, y: 267 },
    })
    const padding = paddingAround(1600, 1066, 0, 267, 1600, 1600)
    expect(padding).toEqual({ left: 0, right: 0, top: 267, bottom: 267 })
  })

  it('自由拖拽用整数模型，不会把 2px 描边放大成约 10px', () => {
    const initial = freeOutpaintGeometry(2048, 1365, 2048, 1365)
    expect(initial.targetSize).toEqual({ width: 2048, height: 1365 })
    expect(initial.originOffset).toEqual({ x: 0, y: 0 })
    expect(initial.sourceSize).toEqual({ width: 2048, height: 1365 })

    const expanded = freeOutpaintGeometry(2048, 1365, 2400, 1800)
    expect(expanded.targetSize).toEqual({ width: 2400, height: 1800 })
    expect(expanded.sourceSize).toEqual({ width: 2048, height: 1365 })
    expect(expanded.originOffset).toEqual({ x: 176, y: 218 })

    const displayScale = outpaintDisplayScale(2048, 1600)
    const frameDisplay = { width: 2048 * displayScale, height: 1600 * displayScale }
    const model = modelSizeFromDisplay(frameDisplay.width, frameDisplay.height, displayScale)
    expect(model).toEqual({ width: 2048, height: 1600 })
    const stroked = modelSizeFromDisplay(frameDisplay.width + 2, frameDisplay.height + 2, displayScale)
    expect(stroked).not.toEqual({ width: 2048, height: 1600 })
    expect(freeOutpaintGeometry(2048, 1365, model.width, model.height).targetSize).toEqual({
      width: 2048,
      height: 1600,
    })
  })

  it('自由拖拽不能小于原图', () => {
    const geo = freeOutpaintGeometry(2048, 1365, 800, 600)
    expect(geo.targetSize).toEqual({ width: 2048, height: 1365 })
  })
})
