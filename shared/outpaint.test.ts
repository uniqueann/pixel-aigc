import { describe, expect, it } from 'vitest'
import { paddingAround, planBailianOutpaint } from './outpaint'

describe('四边留白', () => {
  it('用原图在目标画布中的位置算出四边像素', () => {
    expect(paddingAround(1000, 500, 0, 250, 1000, 1000)).toEqual({ left: 0, right: 0, top: 250, bottom: 250 })
  })

  it('左右取整后的余数补到对边，保证能铺满目标', () => {
    expect(paddingAround(100, 80, 10.6, 4.2, 240, 180)).toEqual({ left: 11, right: 129, top: 4, bottom: 96 })
  })
})

describe('百炼扩图计划', () => {
  it('精确偏移之外再多扩一圈，裁切区域仍是目标画布', () => {
    const plan = planBailianOutpaint(1000, 800, { left: 40, right: 120, top: 10, bottom: 70 })
    expect(plan.inputWidth).toBe(1000)
    expect(plan.inputHeight).toBe(800)
    expect(plan.offsets.left).toBeGreaterThan(40)
    expect(plan.offsets.right - plan.offsets.left).toBe(80)
    expect(plan.crop).toEqual({
      left: plan.offsets.left - 40,
      top: plan.offsets.top - 10,
      width: 1160,
      height: 880,
    })
    expect(plan.targetWidth).toBe(1160)
    expect(plan.targetHeight).toBe(880)
    expect(plan.modelWidth).toBeGreaterThan(plan.crop.width)
    expect(plan.modelWidth / plan.modelHeight).toBeLessThanOrEqual(4)
  })

  it('短边不足 512 时连同留白一起放大，最终目标仍是原来的尺寸', () => {
    const plan = planBailianOutpaint(400, 300, { left: 0, right: 0, top: 50, bottom: 50 })
    expect(plan.inputHeight).toBeGreaterThanOrEqual(512)
    expect(plan.inputWidth).toBeLessThanOrEqual(4096)
    expect(plan.targetWidth).toBe(400)
    expect(plan.targetHeight).toBe(400)
    expect(plan.offsets.top).toBeGreaterThan(0)
    expect(plan.offsets.bottom).toBeGreaterThan(0)
  })

  it('长边超过 4096 时先缩小再计算偏移', () => {
    const plan = planBailianOutpaint(6000, 4000, { left: 100, right: 100, top: 0, bottom: 0 })
    expect(Math.max(plan.inputWidth, plan.inputHeight)).toBeLessThanOrEqual(4096)
    expect(Math.min(plan.inputWidth, plan.inputHeight)).toBeGreaterThanOrEqual(512)
    expect(plan.targetWidth).toBe(6200)
    expect(plan.offsets.left).toBeGreaterThan(0)
    expect(plan.offsets.right).toBeGreaterThan(0)
  })

  it('输出会比 4:1 更宽时，先把短边补足再裁回', () => {
    const plan = planBailianOutpaint(2000, 512, { left: 1500, right: 1500, top: 0, bottom: 0 })
    expect(plan.modelWidth / plan.modelHeight).toBeLessThanOrEqual(4)
    expect(plan.crop.height).toBe(512)
    expect(plan.crop.top).toBeGreaterThan(0)
    expect(plan.targetWidth).toBe(5000)
    expect(plan.targetHeight).toBe(512)
  })

  it('单次偏移盖不住时直接说明，而不是裁掉主体', () => {
    expect(() => planBailianOutpaint(800, 800, { left: 2000, right: 2000, top: 0, bottom: 0 })).toThrow(/水平方向/)
  })

  it('没有留白时不调用扩图', () => {
    expect(() => planBailianOutpaint(800, 600, { left: 0, right: 0, top: 0, bottom: 0 })).toThrow(/没有需要扩展/)
  })
})
