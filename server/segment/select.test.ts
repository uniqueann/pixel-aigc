import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpError } from '../errors.js'
import {
  ALPHA_THRESHOLD,
  GOODS_MATTING_WORKING_MAX_EDGE,
  SELECT_DILATE_RADIUS,
  binarizeAlpha,
  buildSelectionAlpha,
  featherAlpha,
  fitMattingSize,
  fitMattingWorkingSize,
  invertContainedAlpha,
  opaqueCount,
  sourcePoint,
  tintOverlayAsBrush,
} from '../../shared/smart-select.js'
import { prepareGoodsMattingInput } from './tencent-goods.js'
import { clearSmartSelectGoodsCache, selectSmartMask } from './select.js'
import type { GoodsAlpha, SegmentProvider } from './types.js'

function fill(width: number, height: number, paint: (x: number, y: number) => boolean) {
  const alpha = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) alpha[y * width + x] = paint(x, y) ? 255 : 0
  }
  return alpha
}

function goods(alpha: Uint8Array, width: number, height: number): GoodsAlpha {
  return { alpha, width, height, originWidth: width, originHeight: height }
}

describe('smart select geometry', () => {
  it('fits Tencent matting limits and rejects tiny images', () => {
    expect(fitMattingSize(8000, 1000)).toMatchObject({ width: 7680 })
    expect(fitMattingSize(8000, 1000).height).toBeLessThanOrEqual(4320)
    expect(fitMattingSize(400, 300)).toEqual({ width: 400, height: 300, scale: 1 })
    expect(() => fitMattingSize(20, 20)).toThrow('IMAGE_TOO_SMALL')
  })

  it('caps working size so smart-select does not send 4K originals to Tencent', () => {
    expect(fitMattingWorkingSize(1280, 1280)).toEqual({ width: 1280, height: 1280, scale: 1 })
    const portrait = fitMattingWorkingSize(1280, 2014)
    expect(Math.max(portrait.width, portrait.height)).toBe(GOODS_MATTING_WORKING_MAX_EDGE)
    expect(portrait.width / portrait.height).toBeCloseTo(1280 / 2014, 2)
    const huge = fitMattingWorkingSize(8000, 1000)
    expect(Math.max(huge.width, huge.height)).toBe(GOODS_MATTING_WORKING_MAX_EDGE)
  })

  it('ignores letterbox clicks and maps image clicks to 0-1', () => {
    expect(sourcePoint(10, 10, 1000, 500, 640, 420)).toBeNull()
    expect(sourcePoint(320, 210, 1000, 500, 640, 420)).toEqual({ x: 0.5, y: 0.5 })
  })

  it('drops translucent edges and keeps only the component under the click', () => {
    const rgba = new Uint8ClampedArray(8 * 4)
    rgba[3] = 40
    rgba[7] = 200
    expect(binarizeAlpha(rgba, 2, 1, 4)).toEqual(new Uint8Array([0, 255]))

    const alpha = fill(40, 20, (x, y) => (x >= 2 && x <= 8 && y >= 4 && y <= 12) || (x >= 24 && x <= 32 && y >= 4 && y <= 12))
    const selected = buildSelectionAlpha(alpha, 40, 20, { x: 0.12, y: 0.4 })
    expect('alpha' in selected).toBe(true)
    if (!('alpha' in selected)) return
    expect(selected.alpha[6 * 40 + 4]).toBeGreaterThanOrEqual(ALPHA_THRESHOLD)
    expect(selected.alpha[8 * 40 + 28]).toBe(0)
  })

  it('uses the box only to split a connected subject', () => {
    const alpha = fill(40, 20, (_x, y) => y >= 8 && y <= 12)
    const selected = buildSelectionAlpha(alpha, 40, 20, { x: 0.2, y: 0.5 }, { x: 0, y: 0, width: 0.5, height: 1 })
    expect('alpha' in selected).toBe(true)
    if (!('alpha' in selected)) return
    expect(selected.alpha[10 * 40 + 8]).toBeGreaterThanOrEqual(ALPHA_THRESHOLD)
    expect(selected.alpha[10 * 40 + 35]).toBe(0)
  })

  it('feathers outside the dilated core and inverts only inside the image rect', () => {
    const mask = fill(24, 24, (x, y) => x >= 6 && x <= 17 && y >= 6 && y <= 17)
    const grown = featherAlpha(mask, 24, 24, 2)
    expect(grown[12 * 24 + 12]).toBe(255)
    expect(grown[12 * 24 + 4]).toBeGreaterThan(0)
    expect(grown[12 * 24 + 4]).toBeLessThan(255)
    expect(grown[0]).toBe(0)
    expect(SELECT_DILATE_RADIUS).toBeGreaterThan(0)

    const rgba = new Uint8ClampedArray(4 * 4 * 4)
    rgba[3] = 255
    invertContainedAlpha(rgba, 4, 1, { x: 0, y: 0, width: 2, height: 1 })
    expect(rgba[3]).toBe(0)
    expect(rgba[4]).toBe(220)
    expect(rgba[5]).toBe(38)
    expect(rgba[6]).toBe(38)
    expect(rgba[7]).toBe(128)
    expect(rgba[11]).toBe(0)
    expect(opaqueCount(rgba, 4, 1, { x: 0, y: 0, width: 2, height: 1 })).toBe(1)

    const tint = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 0])
    tintOverlayAsBrush(tint)
    expect(Array.from(tint.slice(0, 4))).toEqual([220, 38, 38, 128])
    expect(Array.from(tint.slice(4))).toEqual([0, 0, 0, 0])
  })
})

describe('selectSmartMask', () => {
  beforeEach(() => {
    clearSmartSelectGoodsCache()
  })

  it('reuses the goods alpha session and does not call the provider again', async () => {
    const alpha = fill(32, 32, (x, y) => x >= 8 && x <= 20 && y >= 8 && y <= 22)
    const segmentGoods = vi.fn(async (): Promise<GoodsAlpha> => goods(alpha, 32, 32))
    const provider: SegmentProvider = { id: 'tencent-goods', segmentGoods }
    const first = await selectSmartMask({ image: Buffer.from('image'), point: { x: 0.4, y: 0.4 } }, provider)
    expect(segmentGoods).toHaveBeenCalledTimes(1)
    expect(first.session?.provider).toBe('tencent-goods')
    expect(first.width).toBe(32)
    const png = Buffer.from(first.maskBase64, 'base64')
    const decoded = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(decoded.info.width).toBe(32)
    expect(decoded.data[3]).toBe(0)

    const second = await selectSmartMask({
      point: { x: 0.4, y: 0.45 },
      session: first.session,
    }, provider)
    expect(segmentGoods).toHaveBeenCalledTimes(1)
    expect(second.bbox.width).toBeGreaterThan(0)
  })

  it('returns a miss without painting when the click is on the background', async () => {
    const alpha = fill(32, 32, (x, y) => x >= 4 && x <= 10 && y >= 4 && y <= 10)
    const segmentGoods = vi.fn(async () => goods(alpha, 32, 32))
    const provider: SegmentProvider = { id: 'tencent-goods', segmentGoods }
    const error = await selectSmartMask({ image: Buffer.from('image'), point: { x: 0.8, y: 0.8 } }, provider).catch(caught => caught)
    expect(error).toMatchObject({ status: 422, code: 'SMART_SELECT_MISS' })
    await selectSmartMask({ point: { x: 0.2, y: 0.2 }, session: error.session }, provider)
    expect(segmentGoods).toHaveBeenCalledTimes(1)
  })

  it('rejects a cached session that cannot be decoded when the image is absent', async () => {
    const provider: SegmentProvider = { id: 'tencent-goods', segmentGoods: vi.fn() }
    await expect(selectSmartMask({
      point: { x: 0.2, y: 0.2 },
      session: { provider: 'tencent-goods', payload: '{' },
    }, provider)).rejects.toBeInstanceOf(HttpError)
    expect(provider.segmentGoods).not.toHaveBeenCalled()
  })

  it('caches matting by image bytes so a second click without session skips Tencent', async () => {
    const alpha = fill(32, 32, (x, y) => x >= 8 && x <= 20 && y >= 8 && y <= 22)
    const segmentGoods = vi.fn(async (): Promise<GoodsAlpha> => goods(alpha, 32, 32))
    const provider: SegmentProvider = { id: 'tencent-goods', segmentGoods }
    const image = Buffer.from('same-product-bytes')
    await selectSmartMask({ image, point: { x: 0.4, y: 0.4 } }, provider)
    await selectSmartMask({ image: Buffer.from(image), point: { x: 0.45, y: 0.4 } }, provider)
    expect(segmentGoods).toHaveBeenCalledTimes(1)
  })
})

describe('prepareGoodsMattingInput', () => {
  it('scales wide images into the matting limit and shrinks again to fit the byte cap', async () => {
    const wide = await sharp({
      create: { width: 8000, height: 64, channels: 3, background: { r: 30, g: 80, b: 40 } },
    }).jpeg().toBuffer()
    const fitted = await prepareGoodsMattingInput(wide)
    expect(Math.max(fitted.width, fitted.height)).toBeLessThanOrEqual(GOODS_MATTING_WORKING_MAX_EDGE)
    expect(fitted.height).toBeGreaterThanOrEqual(32)
    expect(fitted.originWidth).toBe(8000)

    const raw = Buffer.alloc(240 * 160 * 3)
    for (let index = 0; index < raw.length; index += 1) raw[index] = (index * 17) % 255
    const noisy = await sharp(raw, { raw: { width: 240, height: 160, channels: 3 } }).jpeg({ quality: 95 }).toBuffer()
    const baseline = await prepareGoodsMattingInput(noisy)
    const cap = Math.floor(baseline.jpeg.length / 2)
    const shrunk = await prepareGoodsMattingInput(noisy, cap)
    expect(shrunk.jpeg.length).toBeLessThanOrEqual(cap)
    expect(shrunk.jpeg.length).toBeLessThan(baseline.jpeg.length)
  })
})
