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

/** 一次百炼扩图的发送参数，以及结果里要裁回精确目标的区域。 */
export interface BailianOutpaintPlan {
  inputWidth: number
  inputHeight: number
  offsets: PixelPadding
  modelWidth: number
  modelHeight: number
  crop: OutpaintCrop
  targetWidth: number
  targetHeight: number
}

const MIN_EDGE = 512
const MAX_EDGE = 4096
const MAX_ASPECT = 4
const SURPLUS_RATIO = 0.02

function limitFor(side: number) {
  return Math.max(0, side * 3 - 1)
}

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

function slack(a: number, b: number, side: number, axis: string) {
  const excess = a + b - limitFor(side)
  if (excess <= 0) return { a, b }
  if (excess > 2) throw new Error(`${axis}方向需要补充的像素超过了扩图服务单次上限，请缩小目标画布或先裁近一些`)
  let left = a
  let right = b
  let remaining = excess
  while (remaining > 0) {
    if (left >= right && left > 0) left -= 1
    else if (right > 0) right -= 1
    else break
    remaining -= 1
  }
  return { a: left, b: right }
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
 * 把四边留白收成百炼 `*_offset`。
 * 输入边长要落在 512–4096，对向偏移之和必须小于原图该边的 3 倍，输出宽高比要在 1:4 到 4:1。
 * 能精确对齐时仍多扩一小圈，本地再裁掉这圈；比例过极端时先把短边补到服务允许的范围，再裁回目标。
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
  if (requested.left + requested.right + requested.top + requested.bottom === 0) throw new Error('没有需要扩展的边缘')
  const targetWidth = sourceWidth + requested.left + requested.right
  const targetHeight = sourceHeight + requested.top + requested.bottom
  const input = fittedInput(sourceWidth, sourceHeight)
  const horizontal = slack(
    scalePad(requested.left, sourceWidth, input.width),
    scalePad(requested.right, sourceWidth, input.width),
    input.width,
    '水平',
  )
  const vertical = slack(
    scalePad(requested.top, sourceHeight, input.height),
    scalePad(requested.bottom, sourceHeight, input.height),
    input.height,
    '垂直',
  )
  const contentWidth = input.width + horizontal.a + horizontal.b
  const contentHeight = input.height + vertical.a + vertical.b
  let extraLeft = 0
  let extraRight = 0
  let extraTop = 0
  let extraBottom = 0
  if (contentWidth > contentHeight * MAX_ASPECT) {
    const needed = Math.ceil(contentWidth / MAX_ASPECT) - contentHeight
    const room = limitFor(input.height) - (vertical.a + vertical.b)
    if (needed > room) throw new Error('目标比例过宽，单次扩图盖不住，请先把原图裁得更接近目标比例')
    extraTop = Math.floor(needed / 2)
    extraBottom = needed - extraTop
  } else if (contentHeight > contentWidth * MAX_ASPECT) {
    const needed = Math.ceil(contentHeight / MAX_ASPECT) - contentWidth
    const room = limitFor(input.width) - (horizontal.a + horizontal.b)
    if (needed > room) throw new Error('目标比例过高，单次扩图盖不住，请先把原图裁得更接近目标比例')
    extraLeft = Math.floor(needed / 2)
    extraRight = needed - extraLeft
  }
  const widenedWidth = contentWidth + extraLeft + extraRight
  const widenedHeight = contentHeight + extraTop + extraBottom
  const surplus = Math.max(8, Math.round(Math.min(widenedWidth, widenedHeight) * SURPLUS_RATIO))
  const roomX = limitFor(input.width) - (horizontal.a + horizontal.b + extraLeft + extraRight)
  const roomY = limitFor(input.height) - (vertical.a + vertical.b + extraTop + extraBottom)
  let ring = Math.max(0, Math.min(surplus, Math.floor(roomX / 2), Math.floor(roomY / 2)))
  if (ring > 0) {
    const ringWidth = widenedWidth + ring * 2
    const ringHeight = widenedHeight + ring * 2
    if (ringWidth > ringHeight * MAX_ASPECT || ringHeight > ringWidth * MAX_ASPECT) ring = 0
  }
  const offsets = {
    left: horizontal.a + extraLeft + ring,
    right: horizontal.b + extraRight + ring,
    top: vertical.a + extraTop + ring,
    bottom: vertical.b + extraBottom + ring,
  }
  return {
    inputWidth: input.width,
    inputHeight: input.height,
    offsets,
    modelWidth: input.width + offsets.left + offsets.right,
    modelHeight: input.height + offsets.top + offsets.bottom,
    crop: {
      left: extraLeft + ring,
      top: extraTop + ring,
      width: contentWidth,
      height: contentHeight,
    },
    targetWidth,
    targetHeight,
  }
}
