/** 业务层只描述四边要补多少像素。供应商适配层再把它换成各自的参数。 */
export interface PixelPadding {
  left: number
  right: number
  top: number
  bottom: number
}

export interface OutpaintCrop {
  left: number
  top: number
  width: number
  height: number
}

export interface BailianExpandScales {
  left: number
  right: number
  top: number
  bottom: number
}

export interface BailianOutpaintPass {
  scales: BailianExpandScales
  modelWidth: number
  modelHeight: number
}

/** 一次或多次万相扩图的发送参数，以及结果里要裁回精确目标的区域。 */
export interface BailianOutpaintPlan {
  inputWidth: number
  inputHeight: number
  passes: BailianOutpaintPass[]
  modelWidth: number
  modelHeight: number
  crop: OutpaintCrop
  targetWidth: number
  targetHeight: number
}

const MIN_EDGE = 512
const MAX_EDGE = 4096
const MIN_SCALE = 1
const MAX_SCALE = 2
const SURPLUS_RATIO = 0.02
export const MAX_EXPAND_PASSES = 2

/** 要求自然延伸背景、不改商品。接口限制 prompt ≤ 800 字符。 */
export const DEFAULT_EXPAND_PROMPT = '自然延伸图片的背景和环境，保持商品主体、形状、比例和细节完全不变，不要添加新的商品或文字，光线、透视和风格与原图一致。'

function scalePad(value: number, source: number, sent: number) {
  if (value <= 0 || source <= 0) return 0
  return Math.max(1, Math.round(value * sent / source))
}

function fittedInput(width: number, height: number) {
  const minSide = Math.min(width, height)
  const maxSide = Math.max(width, height)
  let scale = 1
  if (minSide < MIN_EDGE) scale = MIN_EDGE / minSide
  if (maxSide * scale > MAX_EDGE) scale = MAX_EDGE / maxSide
  let fittedWidth = Math.round(width * scale)
  let fittedHeight = Math.round(height * scale)
  if (fittedWidth > MAX_EDGE || fittedHeight > MAX_EDGE) {
    const down = MAX_EDGE / Math.max(fittedWidth, fittedHeight)
    fittedWidth = Math.round(fittedWidth * down)
    fittedHeight = Math.round(fittedHeight * down)
  }
  if (fittedWidth < MIN_EDGE || fittedHeight < MIN_EDGE || fittedWidth > MAX_EDGE || fittedHeight > MAX_EDGE) {
    throw new Error('原图宽高比超出扩图服务可接受的范围')
  }
  return { width: fittedWidth, height: fittedHeight }
}

function paddingSum(padding: PixelPadding) {
  return padding.left + padding.right + padding.top + padding.bottom
}

/** 单边扩展比例：1.0 不扩，2.0 为该边上限（约增加原图该边长的 1 倍）。 */
export function expandScale(padding: number, side: number): number {
  if (padding <= 0 || side <= 0) return MIN_SCALE
  const raw = 1 + padding / side
  if (raw >= MAX_SCALE) return MAX_SCALE
  return Math.min(MAX_SCALE, Math.max(1.001, Math.ceil(raw * 1000) / 1000))
}

export function addedPixels(side: number, scale: number): number {
  if (side <= 0 || scale <= MIN_SCALE) return 0
  return Math.max(0, Math.round(side * (Math.min(MAX_SCALE, scale) - 1)))
}

export function sizeAfterExpand(width: number, height: number, scales: BailianExpandScales) {
  return {
    width: width + addedPixels(width, scales.left) + addedPixels(width, scales.right),
    height: height + addedPixels(height, scales.top) + addedPixels(height, scales.bottom),
  }
}

function scalesFor(padding: PixelPadding, width: number, height: number): BailianExpandScales {
  return {
    left: expandScale(padding.left, width),
    right: expandScale(padding.right, width),
    top: expandScale(padding.top, height),
    bottom: expandScale(padding.bottom, height),
  }
}

function buildPasses(padding: PixelPadding, inputWidth: number, inputHeight: number) {
  let remaining = { ...padding }
  let width = inputWidth
  let height = inputHeight
  let originX = 0
  let originY = 0
  const passes: BailianOutpaintPass[] = []
  while (paddingSum(remaining) > 0) {
    if (passes.length >= MAX_EXPAND_PASSES) {
      throw new Error('目标尺寸超出扩图服务可扩展范围（每边最多扩到 2 倍，最多两次），请先把原图裁得更接近目标比例')
    }
    const scales = scalesFor(remaining, width, height)
    const addLeft = addedPixels(width, scales.left)
    const addRight = addedPixels(width, scales.right)
    const addTop = addedPixels(height, scales.top)
    const addBottom = addedPixels(height, scales.bottom)
    if (addLeft + addRight + addTop + addBottom === 0) {
      throw new Error('目标尺寸超出扩图服务可扩展范围（每边最多扩到 2 倍，最多两次），请先把原图裁得更接近目标比例')
    }
    originX += addLeft
    originY += addTop
    width += addLeft + addRight
    height += addTop + addBottom
    remaining = {
      left: Math.max(0, remaining.left - addLeft),
      right: Math.max(0, remaining.right - addRight),
      top: Math.max(0, remaining.top - addTop),
      bottom: Math.max(0, remaining.bottom - addBottom),
    }
    passes.push({ scales, modelWidth: width, modelHeight: height })
  }
  return { passes, originX, originY, modelWidth: width, modelHeight: height }
}

/** 原图在目标画布上的位置，换成上下左右要补的像素。 */
export function paddingAround(
  sourceWidth: number,
  sourceHeight: number,
  originX: number,
  originY: number,
  targetWidth: number,
  targetHeight: number,
): PixelPadding {
  const left = Math.max(0, Math.round(originX))
  const top = Math.max(0, Math.round(originY))
  return {
    left,
    top,
    right: Math.max(0, Math.round(targetWidth) - left - Math.round(sourceWidth)),
    bottom: Math.max(0, Math.round(targetHeight) - top - Math.round(sourceHeight)),
  }
}

/**
 * 把四边留白收成万相 `*_scale`（1.0–2.0）。
 * 输入边长要落在 512–4096。单边一次最多扩到 2 倍；仍盖不住时安排第二次 expand。
 * 一次就能盖住时仍多扩一小圈，本地再裁成精确目标尺寸。
 */
export function planBailianOutpaint(sourceWidth: number, sourceHeight: number, padding: PixelPadding): BailianOutpaintPlan {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth < 1 || sourceHeight < 1) {
    throw new Error('原图尺寸无效')
  }
  const requested = {
    left: Math.max(0, Math.round(padding.left)),
    right: Math.max(0, Math.round(padding.right)),
    top: Math.max(0, Math.round(padding.top)),
    bottom: Math.max(0, Math.round(padding.bottom)),
  }
  if (paddingSum(requested) === 0) throw new Error('没有需要扩展的边缘')
  const targetWidth = Math.round(sourceWidth) + requested.left + requested.right
  const targetHeight = Math.round(sourceHeight) + requested.top + requested.bottom
  const input = fittedInput(sourceWidth, sourceHeight)
  const fittedPadding = {
    left: scalePad(requested.left, sourceWidth, input.width),
    right: scalePad(requested.right, sourceWidth, input.width),
    top: scalePad(requested.top, sourceHeight, input.height),
    bottom: scalePad(requested.bottom, sourceHeight, input.height),
  }
  const contentWidth = input.width + fittedPadding.left + fittedPadding.right
  const contentHeight = input.height + fittedPadding.top + fittedPadding.bottom
  const surplus = Math.max(8, Math.round(Math.min(contentWidth, contentHeight) * SURPLUS_RATIO))
  const withSurplus = {
    left: fittedPadding.left + surplus,
    right: fittedPadding.right + surplus,
    top: fittedPadding.top + surplus,
    bottom: fittedPadding.bottom + surplus,
  }
  const base = buildPasses(fittedPadding, input.width, input.height)
  let chosen = base
  try {
    const extra = buildPasses(withSurplus, input.width, input.height)
    if (extra.passes.length <= base.passes.length) chosen = extra
  } catch {
    chosen = base
  }
  const last = chosen.passes[chosen.passes.length - 1]
  const crop = {
    left: Math.min(Math.max(0, chosen.originX - fittedPadding.left), last.modelWidth - 1),
    top: Math.min(Math.max(0, chosen.originY - fittedPadding.top), last.modelHeight - 1),
    width: Math.min(contentWidth, last.modelWidth),
    height: Math.min(contentHeight, last.modelHeight),
  }
  if (crop.left + crop.width > last.modelWidth) crop.width = last.modelWidth - crop.left
  if (crop.top + crop.height > last.modelHeight) crop.height = last.modelHeight - crop.top
  return {
    inputWidth: input.width,
    inputHeight: input.height,
    passes: chosen.passes,
    modelWidth: last.modelWidth,
    modelHeight: last.modelHeight,
    crop,
    targetWidth,
    targetHeight,
  }
}
