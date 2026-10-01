import { describe, expect, it } from 'vitest'
import {
  addedPixels,
  expandScale,
  paddingAround,
  presetOutpaintSize,
  planBailianOutpaint,
  sizeAfterExpand,
  validateOutpaintOutputSize,
} from './outpaint'

describe('扩图输出尺寸', () => {
  it('大图按平台比例扩画布，保留原图像素；平台模式仍用指定尺寸', () => {
    expect(presetOutpaintSize(3200, 5035, 1600, 1600, 'original')).toEqual({ width: 5035, height: 5035 })
    expect(presetOutpaintSize(3200, 5035, 1600, 1600, 'platform')).toEqual({ width: 1600, height: 1600 })
    expect(presetOutpaintSize(800, 400, 1600, 1600, 'original')).toEqual({ width: 800, height: 800 })
  })

  it('非方形预设的整数画布完整包含原图，超大合成画布明确拒绝', () => {
    const size = presetOutpaintSize(3200, 5035, 1080, 1440, 'original')
    expect(size).toEqual({ width: 3776, height: 5035 })
    expect(() => validateOutpaintOutputSize(5035, 5035)).not.toThrow()
    expect(() => validateOutpaintOutputSize(10000, 10000)).toThrow(/6400 万像素/)
  })
})

describe('四边留白', () => {
  it('用原图在目标画布中的位置算出四边像素', () => {
    expect(paddingAround(1000, 500, 0, 250, 1000, 1000)).toEqual({ left: 0, right: 0, top: 250, bottom: 250 })
  })

  it('左右取整后的余数补到对边，保证能铺满目标', () => {
    expect(paddingAround(100, 80, 10.6, 4.2, 240, 180)).toEqual({ left: 11, right: 129, top: 4, bottom: 96 })
  })
})

describe('万相扩图比例', () => {
  it('按增加的像素换算成 1.0–2.0 的单边比例', () => {
    expect(expandScale(0, 800)).toBe(1)
    expect(expandScale(400, 800)).toBe(1.5)
    expect(expandScale(800, 800)).toBe(2)
    expect(expandScale(1200, 800)).toBe(2)
  })

  it('扩展后的宽高等于原图加上各边增加的像素', () => {
    expect(sizeAfterExpand(1000, 800, { left: 1.1, right: 1.2, top: 1, bottom: 1.25 })).toEqual({
      width: 1000 + addedPixels(1000, 1.1) + addedPixels(1000, 1.2),
      height: 800 + addedPixels(800, 1.25),
    })
  })
})

describe('万相扩图计划', () => {
  it('一次扩图即可时用四边 scale，裁切后仍是精确目标尺寸', () => {
    const plan = planBailianOutpaint(1000, 800, { left: 40, right: 120, top: 10, bottom: 70 })
    expect(plan.inputWidth).toBe(1000)
    expect(plan.inputHeight).toBe(800)
    expect(plan.passes).toHaveLength(1)
    const scales = plan.passes[0].scales
    expect(scales.left).toBeGreaterThan(1)
    expect(scales.right).toBeGreaterThan(scales.left)
    expect(scales.top).toBeGreaterThan(1)
    expect(scales.bottom).toBeGreaterThan(scales.top)
    expect(scales.left).toBeLessThanOrEqual(2)
    expect(scales.right).toBeLessThanOrEqual(2)
    expect(plan.crop).toEqual({
      left: plan.crop.left,
      top: plan.crop.top,
      width: 1160,
      height: 880,
    })
    expect(plan.crop.left).toBeGreaterThan(0)
    expect(plan.crop.top).toBeGreaterThan(0)
    expect(plan.targetWidth).toBe(1160)
    expect(plan.targetHeight).toBe(880)
    expect(plan.modelWidth).toBeGreaterThanOrEqual(plan.crop.left + plan.crop.width)
    expect(plan.modelHeight).toBeGreaterThanOrEqual(plan.crop.top + plan.crop.height)
    expect(plan.crop.left + plan.crop.width).toBeLessThanOrEqual(plan.modelWidth)
    expect(plan.crop.top + plan.crop.height).toBeLessThanOrEqual(plan.modelHeight)
  })

  it('居中补边时左右或上下比例相同', () => {
    const plan = planBailianOutpaint(1600, 800, { left: 0, right: 0, top: 400, bottom: 400 })
    expect(plan.passes).toHaveLength(1)
    expect(plan.passes[0].scales.top).toBe(plan.passes[0].scales.bottom)
    expect(plan.passes[0].scales.left).toBe(plan.passes[0].scales.right)
    expect(plan.passes[0].scales.top).toBeGreaterThan(plan.passes[0].scales.left)
    expect(plan.targetWidth).toBe(1600)
    expect(plan.targetHeight).toBe(1600)
    expect(plan.crop.width).toBe(1600)
    expect(plan.crop.height).toBe(1600)
  })

  it('短边不足 512 时连同留白一起放大，最终目标仍是原来的尺寸', () => {
    const plan = planBailianOutpaint(400, 300, { left: 0, right: 0, top: 50, bottom: 50 })
    expect(plan.inputHeight).toBeGreaterThanOrEqual(512)
    expect(plan.inputWidth).toBeLessThanOrEqual(4096)
    expect(plan.targetWidth).toBe(400)
    expect(plan.targetHeight).toBe(400)
    expect(plan.passes[0].scales.top).toBeGreaterThan(1)
    expect(plan.passes[0].scales.bottom).toBeGreaterThan(1)
    expect(plan.crop.width).toBeGreaterThan(0)
    expect(plan.crop.height).toBeGreaterThan(0)
  })

  it('长边超过 4096 时先缩小再计算比例', () => {
    const plan = planBailianOutpaint(6000, 4000, { left: 100, right: 100, top: 0, bottom: 0 })
    expect(Math.max(plan.inputWidth, plan.inputHeight)).toBeLessThanOrEqual(4096)
    expect(Math.min(plan.inputWidth, plan.inputHeight)).toBeGreaterThanOrEqual(512)
    expect(plan.targetWidth).toBe(6200)
    expect(plan.targetHeight).toBe(4000)
    expect(plan.passes[0].scales.left).toBeGreaterThan(1)
    expect(plan.passes[0].scales.right).toBeGreaterThan(1)
    expect(plan.crop.width).toBeGreaterThan(plan.inputWidth)
  })

  it('单边超过 2 倍时拆成第二次 expand，最终仍能裁回目标', () => {
    const plan = planBailianOutpaint(800, 800, { left: 2000, right: 2000, top: 0, bottom: 0 })
    expect(plan.passes.length).toBe(2)
    for (const pass of plan.passes) {
      expect(pass.scales.left).toBeGreaterThan(1)
      expect(pass.scales.left).toBeLessThanOrEqual(2)
      expect(pass.scales.right).toBeGreaterThan(1)
      expect(pass.scales.right).toBeLessThanOrEqual(2)
    }
    expect(plan.passes[0].scales.left).toBe(2)
    expect(plan.passes[0].modelWidth).toBe(2400)
    expect(plan.targetWidth).toBe(4800)
    expect(plan.targetHeight).toBe(800)
    expect(plan.crop.width).toBe(4800)
    expect(plan.crop.height).toBe(800)
    expect(plan.modelWidth).toBeGreaterThanOrEqual(4800)
    expect(plan.crop.left + plan.crop.width).toBeLessThanOrEqual(plan.modelWidth)
  })

  it('两次仍盖不住时直接说明，而不是裁掉主体', () => {
    expect(() => planBailianOutpaint(800, 800, { left: 4000, right: 4000, top: 0, bottom: 0 })).toThrow(/最多两次/)
  })

  it('没有留白时不调用扩图', () => {
    expect(() => planBailianOutpaint(800, 600, { left: 0, right: 0, top: 0, bottom: 0 })).toThrow(/没有需要扩展/)
  })

  it('2048×1365 居中进 1600×1600 只需一次 expand，且远低于 2 倍', () => {
    const plan = planBailianOutpaint(1600, 1066, { left: 0, right: 0, top: 267, bottom: 267 })
    expect(plan.passes).toHaveLength(1)
    expect(plan.targetWidth).toBe(1600)
    expect(plan.targetHeight).toBe(1600)
    expect(plan.crop.width).toBe(1600)
    expect(plan.crop.height).toBe(1600)
    const scales = plan.passes[0].scales
    expect(scales.top).toBeLessThan(1.5)
    expect(scales.bottom).toBeLessThan(1.5)
    expect(scales.top).toBe(scales.bottom)
    expect(Math.max(scales.left, scales.right, scales.top, scales.bottom)).toBeLessThan(2)
  })
})
