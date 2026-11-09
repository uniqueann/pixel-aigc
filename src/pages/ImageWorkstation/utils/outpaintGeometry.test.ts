import { describe, expect, it } from 'vitest'
import { PLATFORM_SIZE_PRESETS } from '@/constants/platformSizes'
import { planBailianOutpaint, paddingAround } from '../../../../shared/outpaint'
import {
  canStepOutpaintTargetSize,
  clampOutpaintTargetSize,
  freeOutpaintDisplayScale,
  freeOutpaintGeometry,
  modelSizeFromDisplay,
  nudgeOutpaintTargetSize,
  OUTPAINT_VIEW_HEIGHT,
  OUTPAINT_VIEW_PADDING,
  OUTPAINT_VIEW_WIDTH,
  outpaintControlSizes,
  outpaintDisplayScale,
  outpaintHasWork,
  outpaintLimitReason,
  outpaintPadStrips,
  presetOutpaintGeometry,
  stepOutpaintTargetSize,
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

describe('扩图目标尺寸收口', () => {
  it('合法尺寸原样返回', () => {
    expect(clampOutpaintTargetSize(1000, 800, 1200, 900)).toEqual({
      size: { width: 1200, height: 900 },
      clamped: false,
    })
  })

  it('小于原图时收回到原图', () => {
    expect(clampOutpaintTargetSize(1000, 800, 200, 100)).toEqual({
      size: { width: 1000, height: 800 },
      clamped: false,
    })
  })

  it('单边最多扩到原图 2 倍', () => {
    expect(clampOutpaintTargetSize(1000, 800, 5000, 4000)).toEqual({
      size: { width: 2000, height: 1600 },
      clamped: true,
    })
  })

  it('总像素不超过 6400 万', () => {
    const result = clampOutpaintTargetSize(8000, 8000, 16000, 16000)
    expect(result.clamped).toBe(true)
    expect(result.size.width * result.size.height).toBeLessThanOrEqual(64_000_000)
    expect(result.size.width).toBeGreaterThanOrEqual(8000)
    expect(result.size.height).toBeGreaterThanOrEqual(8000)
  })

  it('非法输入回落到原图', () => {
    expect(clampOutpaintTargetSize(1000, 800, Number.NaN, Number.POSITIVE_INFINITY)).toEqual({
      size: { width: 1000, height: 800 },
      clamped: false,
    })
  })
})

describe('扩图自由拖拽取景', () => {
  const source = { width: 480, height: 320 }

  it('初始取景给 1.5 倍扩展空间，原图不会贴边', () => {
    const scale = freeOutpaintDisplayScale(source.width, source.height, source.width, source.height)
    expect(source.width * scale).toBeLessThan(OUTPAINT_VIEW_WIDTH - OUTPAINT_VIEW_PADDING)
    expect(source.height * scale).toBeLessThan(OUTPAINT_VIEW_HEIGHT - OUTPAINT_VIEW_PADDING)
  })

  it('目标更大时整体缩小，始终装得进可视画布', () => {
    const initial = freeOutpaintDisplayScale(source.width, source.height, source.width, source.height)
    const expanded = freeOutpaintDisplayScale(source.width, source.height, source.width * 2, source.height * 2)
    expect(expanded).toBeLessThan(initial)
    expect(source.width * 2 * expanded).toBeLessThanOrEqual(OUTPAINT_VIEW_WIDTH - OUTPAINT_VIEW_PADDING * 2)
    expect(source.height * 2 * expanded).toBeLessThanOrEqual(OUTPAINT_VIEW_HEIGHT - OUTPAINT_VIEW_PADDING * 2)
  })
})

describe('扩图是否真的会改动画面', () => {
  it('自由模式目标等于原图时没有扩图工作', () => {
    const geometry = freeOutpaintGeometry(480, 480, 480, 480)
    expect(outpaintHasWork(480, 480, geometry)).toBe(false)
  })

  it('自由模式扩大后有留白', () => {
    const geometry = freeOutpaintGeometry(480, 480, 960, 720)
    expect(outpaintHasWork(480, 480, geometry)).toBe(true)
  })

  it('平台精确尺寸同比例时靠缩放也算有工作', () => {
    const geometry = presetOutpaintGeometry(480, 480, 1600, 1600, 'platform')
    expect(outpaintHasWork(480, 480, geometry)).toBe(true)
  })

  it('平台比例与原图比例相同时没有工作', () => {
    const geometry = presetOutpaintGeometry(480, 480, 1600, 1600, 'original')
    expect(outpaintHasWork(480, 480, geometry)).toBe(false)
  })

  it('平台比例与原图比例不同时有留白', () => {
    const geometry = presetOutpaintGeometry(480, 320, 1600, 1600, 'original')
    expect(outpaintHasWork(480, 320, geometry)).toBe(true)
  })
})

describe('扩图控制点触控尺寸', () => {
  it('桌面视觉保持 13px，触控热区 24px', () => {
    expect(outpaintControlSizes(1)).toEqual({ visual: 13, touch: 24 })
  })

  it('移动端按画布缩放反向补偿，视觉至少 12px、热区至少 24px', () => {
    for (const scale of [1, 0.75, 0.5, 0.2734, 0.2]) {
      const { visual, touch } = outpaintControlSizes(scale)
      expect(visual * scale).toBeGreaterThanOrEqual(12)
      expect(touch * scale).toBeGreaterThanOrEqual(24)
    }
    expect(outpaintControlSizes(0.2734)).toEqual({ visual: 44, touch: 88 })
  })

  it('非法缩放回落到默认尺寸', () => {
    expect(outpaintControlSizes(0)).toEqual({ visual: 13, touch: 24 })
    expect(outpaintControlSizes(Number.NaN)).toEqual({ visual: 13, touch: 24 })
  })
})

describe('扩图尺寸步进', () => {
  it('每次按当前目标 10% 放大', () => {
    expect(stepOutpaintTargetSize(480, 320, { width: 480, height: 320 }, 1).size).toEqual({
      width: 528,
      height: 352,
    })
  })

  it('缩小不会低于原图', () => {
    expect(stepOutpaintTargetSize(480, 320, { width: 480, height: 320 }, -1)).toEqual({
      size: { width: 480, height: 320 },
      clamped: false,
    })
    expect(canStepOutpaintTargetSize(480, 320, { width: 480, height: 320 }, -1)).toBe(false)
  })

  it('放大不会超过单边 2 倍', () => {
    expect(stepOutpaintTargetSize(480, 320, { width: 960, height: 640 }, 1).size).toEqual({
      width: 960,
      height: 640,
    })
    expect(canStepOutpaintTargetSize(480, 320, { width: 960, height: 640 }, 1)).toBe(false)
  })

  it('只有一个方向到顶时仍可继续放大另一方向', () => {
    expect(stepOutpaintTargetSize(480, 320, { width: 960, height: 320 }, 1).size).toEqual({
      width: 960,
      height: 352,
    })
    expect(canStepOutpaintTargetSize(480, 320, { width: 960, height: 320 }, 1)).toBe(true)
  })

  it('超过总像素上限时按比例收口', () => {
    const result = stepOutpaintTargetSize(5000, 5000, { width: 10000, height: 10000 }, 1)
    expect(result.size).toEqual({ width: 8000, height: 8000 })
    expect(result.clamped).toBe(true)
  })
})

describe('扩图键盘微调', () => {
  it('左右键调整宽度，上下键调整高度', () => {
    expect(nudgeOutpaintTargetSize(480, 320, { width: 480, height: 320 }, 'width', 1, 32).size).toEqual({
      width: 512,
      height: 320,
    })
    expect(nudgeOutpaintTargetSize(480, 320, { width: 480, height: 320 }, 'height', 1, 32).size).toEqual({
      width: 480,
      height: 352,
    })
    expect(nudgeOutpaintTargetSize(480, 320, { width: 512, height: 352 }, 'width', -1, 32).size).toEqual({
      width: 480,
      height: 352,
    })
    expect(nudgeOutpaintTargetSize(480, 320, { width: 512, height: 352 }, 'height', -1, 32).size).toEqual({
      width: 512,
      height: 320,
    })
  })

  it('Shift 大步长仍受 2 倍上限约束', () => {
    expect(nudgeOutpaintTargetSize(480, 320, { width: 900, height: 320 }, 'width', 1, 128).size).toEqual({
      width: 960,
      height: 320,
    })
    expect(nudgeOutpaintTargetSize(480, 320, { width: 960, height: 320 }, 'width', 1, 128).size).toEqual({
      width: 960,
      height: 320,
    })
  })

  it('缩小不会低于原图', () => {
    expect(nudgeOutpaintTargetSize(480, 320, { width: 480, height: 320 }, 'width', -1, 32).size).toEqual({
      width: 480,
      height: 320,
    })
  })
})


describe('扩图区填充块', () => {
  it('只覆盖原图之外的新增区域，四块不重叠且面积等于扩图面积', () => {
    const strips = outpaintPadStrips(
      { width: 960, height: 720 },
      { x: 240, y: 120 },
      { width: 480, height: 480 },
      1,
      { x: 320, y: 210 },
    )
    expect(strips).toEqual([
      { left: -160, top: -150, width: 960, height: 120 },
      { left: -160, top: 450, width: 960, height: 120 },
      { left: -160, top: -30, width: 240, height: 480 },
      { left: 560, top: -30, width: 240, height: 480 },
    ])
    const area = strips.reduce((sum, strip) => sum + strip.width * strip.height, 0)
    expect(area).toBe(960 * 720 - 480 * 480)
  })

  it('目标等于原图时没有填充块', () => {
    const strips = outpaintPadStrips(
      { width: 480, height: 480 },
      { x: 0, y: 0 },
      { width: 480, height: 480 },
      1,
      { x: 320, y: 210 },
    )
    expect(strips.every(strip => strip.width === 0 || strip.height === 0)).toBe(true)
  })

  it('原图偏左时右侧填充块补齐剩余宽度', () => {
    const strips = outpaintPadStrips(
      { width: 600, height: 400 },
      { x: 0, y: 100 },
      { width: 400, height: 200 },
      1,
      { x: 320, y: 210 },
    )
    expect(strips[2]).toEqual({ left: 20, top: 110, width: 0, height: 200 })
    expect(strips[3]).toEqual({ left: 420, top: 110, width: 200, height: 200 })
    const area = strips.reduce((sum, strip) => sum + strip.width * strip.height, 0)
    expect(area).toBe(600 * 400 - 400 * 200)
  })
})


describe('扩图上限判断', () => {
  it('单边到 2 倍时提示尺寸上限', () => {
    expect(outpaintLimitReason(480, 480, { width: 960, height: 480 })).toBe('size')
    expect(outpaintLimitReason(480, 480, { width: 480, height: 960 })).toBe('size')
    expect(outpaintLimitReason(480, 480, { width: 959, height: 480 })).toBeUndefined()
  })

  it('大图先撞到 64MP 时提示像素上限', () => {
    const clamped = clampOutpaintTargetSize(5000, 4000, 10000, 8000).size
    expect(outpaintLimitReason(5000, 4000, clamped)).toBe('pixels')
    expect(outpaintLimitReason(5000, 4000, { width: 8000, height: 6000 })).toBeUndefined()
  })

  it('尺寸未知时不提示', () => {
    expect(outpaintLimitReason(0, 0, { width: 960, height: 960 })).toBeUndefined()
  })
})
