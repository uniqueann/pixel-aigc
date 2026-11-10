import { expansionPlan } from '@/pages/Toolbox/aspect-ratio/expansion'
import { MAX_OUTPAINT_OUTPUT_PIXELS, MAX_SCALE, paddingAround, type OutpaintOutputMode } from '@shared/outpaint'

export const OUTPAINT_VIEW_WIDTH = 640
export const OUTPAINT_VIEW_HEIGHT = 420
export const OUTPAINT_VIEW_PADDING = 48
/** 自由拖拽默认给用户留出的扩展空间：原图的 1.5 倍。 */
export const OUTPAINT_FREE_HEADROOM = 1.5
/** 控制点在屏幕上的最小触控边长（CSS px）。 */
export const OUTPAINT_CONTROL_MIN_CSS_SIZE = 24
/** 控制点未缩放时的视觉边长（画布单位）。 */
export const OUTPAINT_CONTROL_VISUAL_SIZE = 13
/** 控制点在屏幕上的最小视觉边长（CSS px）：视觉可小，热区要大。 */
export const OUTPAINT_CONTROL_VISUAL_MIN_CSS_SIZE = 12
/** 扩图边框与控制点：浅灰画布和白底上均达到 3:1。 */
export const OUTPAINT_FRAME_COLOR = '#0f8f6f'

export interface OutpaintModelGeometry {
  targetSize: { width: number; height: number }
  originOffset: { x: number; y: number }
  sourceSize: { width: number; height: number }
}

/** 平台预设：按输出模式计算画布，与工具箱转比例使用同一套扩图计划。 */
export function presetOutpaintGeometry(
  sourceWidth: number,
  sourceHeight: number,
  presetWidth: number,
  presetHeight: number,
  outputMode: OutpaintOutputMode = 'platform',
): OutpaintModelGeometry {
  const plan = expansionPlan(sourceWidth, sourceHeight, presetWidth, presetHeight, outputMode)
  return {
    targetSize: plan.targetSize,
    originOffset: plan.originOffset,
    sourceSize: plan.sourceSize,
  }
}

/** 自由拖拽：目标不小于原图，原图居中；尺寸来自整数模型，不读描边。 */
export function freeOutpaintGeometry(
  sourceWidth: number,
  sourceHeight: number,
  frameWidth: number,
  frameHeight: number,
): OutpaintModelGeometry {
  const width = Math.max(sourceWidth, Math.max(1, Math.round(frameWidth)))
  const height = Math.max(sourceHeight, Math.max(1, Math.round(frameHeight)))
  return {
    targetSize: { width, height },
    originOffset: {
      x: Math.max(0, Math.round((width - sourceWidth) / 2)),
      y: Math.max(0, Math.round((height - sourceHeight) / 2)),
    },
    sourceSize: { width: sourceWidth, height: sourceHeight },
  }
}

export function outpaintDisplayScale(targetWidth: number, targetHeight: number) {
  return Math.min(
    (OUTPAINT_VIEW_WIDTH - OUTPAINT_VIEW_PADDING * 2) / targetWidth,
    (OUTPAINT_VIEW_HEIGHT - OUTPAINT_VIEW_PADDING * 2) / targetHeight,
  )
}

/**
 * 自由拖拽的显示比例：先给原图留出 1.5 倍扩展空间，目标更大时再整体缩小以装下。
 * 这样边框和控制点始终留在 640×420 的可视画布内。
 */
export function freeOutpaintDisplayScale(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
) {
  return Math.min(
    outpaintDisplayScale(sourceWidth * OUTPAINT_FREE_HEADROOM, sourceHeight * OUTPAINT_FREE_HEADROOM),
    outpaintDisplayScale(targetWidth, targetHeight),
  )
}

export interface OutpaintTargetClamp {
  size: { width: number; height: number }
  clamped: boolean
}

/**
 * 把拖拽或数值输入得到的目标尺寸收进服务端可接受的范围：
 * 单边最多扩到原图 2 倍，总像素不超过 6400 万。
 * 2 倍上限同时也保证一次扩图轮次足够，不会触发「最多两次」的报错。
 */
export function clampOutpaintTargetSize(
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
): OutpaintTargetClamp {
  const minWidth = Math.max(1, Math.round(sourceWidth))
  const minHeight = Math.max(1, Math.round(sourceHeight))
  let nextWidth = Math.max(minWidth, Math.round(Number.isFinite(width) ? width : minWidth))
  let nextHeight = Math.max(minHeight, Math.round(Number.isFinite(height) ? height : minHeight))
  let clamped = false

  const maxWidth = Math.round(minWidth * MAX_SCALE)
  const maxHeight = Math.round(minHeight * MAX_SCALE)
  if (nextWidth > maxWidth) {
    nextWidth = maxWidth
    clamped = true
  }
  if (nextHeight > maxHeight) {
    nextHeight = maxHeight
    clamped = true
  }

  if (nextWidth * nextHeight > MAX_OUTPAINT_OUTPUT_PIXELS) {
    const ratio = Math.sqrt(MAX_OUTPAINT_OUTPUT_PIXELS / (nextWidth * nextHeight))
    nextWidth = Math.max(minWidth, Math.floor(nextWidth * ratio))
    nextHeight = Math.max(minHeight, Math.floor(nextHeight * ratio))
    clamped = true
  }

  return { size: { width: nextWidth, height: nextHeight }, clamped }
}

export interface OutpaintControlSize {
  /** 绘制尺寸，同时也是鼠标命中区。 */
  visual: number
  /** 触控命中区；只放大热区，不放大视觉。 */
  touch: number
}

/**
 * 控制点尺寸按画布缩放反向补偿：
 * 视觉至少 12 CSS px，触控热区至少 24 CSS px。
 * 画布在移动端会被缩到 0.27 倍左右，直接沿用 13 画布单位只剩 3.6px。
 */
export function outpaintControlSizes(stageScale: number): OutpaintControlSize {
  if (!Number.isFinite(stageScale) || stageScale <= 0) {
    return { visual: OUTPAINT_CONTROL_VISUAL_SIZE, touch: OUTPAINT_CONTROL_MIN_CSS_SIZE }
  }
  const visual = Math.max(OUTPAINT_CONTROL_VISUAL_SIZE, Math.ceil(OUTPAINT_CONTROL_VISUAL_MIN_CSS_SIZE / stageScale))
  const touch = Math.max(visual, Math.ceil(OUTPAINT_CONTROL_MIN_CSS_SIZE / stageScale))
  return { visual, touch }
}

/**
 * 触控步进：每次按当前目标的 10% 调整，最小 32px，再收口到原图与 2 倍之间。
 * 用按钮代替拖拽，移动端不需要精确抓住控制点。
 */
export function stepOutpaintTargetSize(
  sourceWidth: number,
  sourceHeight: number,
  target: { width: number; height: number },
  direction: 1 | -1,
  ratio = 0.1,
): OutpaintTargetClamp {
  const stepWidth = Math.max(32, Math.round(target.width * ratio))
  const stepHeight = Math.max(32, Math.round(target.height * ratio))
  return clampOutpaintTargetSize(
    sourceWidth,
    sourceHeight,
    target.width + direction * stepWidth,
    target.height + direction * stepHeight,
  )
}

/** 步进是否还能改变目标尺寸，用来禁用到达上下限的按钮。 */
export function canStepOutpaintTargetSize(
  sourceWidth: number,
  sourceHeight: number,
  target: { width: number; height: number },
  direction: 1 | -1,
) {
  const next = stepOutpaintTargetSize(sourceWidth, sourceHeight, target, direction)
  return next.size.width !== target.width || next.size.height !== target.height
}

/**
 * 键盘微调：方向键只改一个方向，Shift 使用更大步长。
 * 收口规则与拖拽、输入框一致，避免键盘能调到服务端拒绝的尺寸。
 */
export function nudgeOutpaintTargetSize(
  sourceWidth: number,
  sourceHeight: number,
  target: { width: number; height: number },
  axis: 'width' | 'height',
  direction: 1 | -1,
  step: number,
): OutpaintTargetClamp {
  const delta = Math.max(1, Math.round(Math.abs(step)))
  return clampOutpaintTargetSize(
    sourceWidth,
    sourceHeight,
    target.width + (axis === 'width' ? direction * delta : 0),
    target.height + (axis === 'height' ? direction * delta : 0),
  )
}

/** 把画布上的框换算成整数像素。用对象宽高×缩放，不用包含描边的 bounding box。 */
export function modelSizeFromDisplay(displayWidth: number, displayHeight: number, displayScale: number) {
  if (displayScale <= 0) return { width: 1, height: 1 }
  return {
    width: Math.max(1, Math.round(displayWidth / displayScale)),
    height: Math.max(1, Math.round(displayHeight / displayScale)),
  }
}

/**
 * 当前目标是否真的会改动画面：
 * 有留白需要扩图，或平台模式需要把原图缩放到目标尺寸。
 * 两者都没有时，控制器会直接返回原图副本，应在提交前拦下。
 */
export function outpaintHasWork(
  inputWidth: number,
  inputHeight: number,
  geometry: OutpaintModelGeometry,
) {
  const padding = paddingAround(
    geometry.sourceSize.width,
    geometry.sourceSize.height,
    geometry.originOffset.x,
    geometry.originOffset.y,
    geometry.targetSize.width,
    geometry.targetSize.height,
  )
  const padded = padding.left + padding.right + padding.top + padding.bottom > 0
  const scaled = geometry.sourceSize.width !== inputWidth || geometry.sourceSize.height !== inputHeight
  return padded || scaled
}

/** 画布坐标系里的填充块；四块拼成「目标区域减去原图」的扩图区。 */
export interface OutpaintPadStrip {
  left: number
  top: number
  width: number
  height: number
}

/**
 * 只返回新增区域的填充块，避免整块蒙层压在原图上把商品图染绿。
 * 上、下铺满目标宽度，左、右只铺原图高度，四块互不重叠。
 */
export function outpaintPadStrips(
  targetSize: { width: number; height: number },
  originOffset: { x: number; y: number },
  sourceSize: { width: number; height: number },
  displayScale: number,
  center: { x: number; y: number },
): OutpaintPadStrip[] {
  const targetWidth = targetSize.width * displayScale
  const targetHeight = targetSize.height * displayScale
  const sourceWidth = sourceSize.width * displayScale
  const sourceHeight = sourceSize.height * displayScale
  const targetLeft = center.x - targetWidth / 2
  const targetTop = center.y - targetHeight / 2
  const sourceLeft = center.x + (originOffset.x - targetSize.width / 2) * displayScale
  const sourceTop = center.y + (originOffset.y - targetSize.height / 2) * displayScale
  const top = Math.max(0, sourceTop - targetTop)
  const bottom = Math.max(0, targetTop + targetHeight - (sourceTop + sourceHeight))
  const left = Math.max(0, sourceLeft - targetLeft)
  const right = Math.max(0, targetLeft + targetWidth - (sourceLeft + sourceWidth))
  return [
    { left: targetLeft, top: targetTop, width: targetWidth, height: top },
    { left: targetLeft, top: sourceTop + sourceHeight, width: targetWidth, height: bottom },
    { left: targetLeft, top: sourceTop, width: left, height: sourceHeight },
    { left: sourceLeft + sourceWidth, top: sourceTop, width: right, height: sourceHeight },
  ]
}

export type OutpaintLimit = 'size' | 'pixels'

/**
 * 目标是否已经顶到服务端上限：
 * size 表示单边到 2 倍，pixels 表示总像素到 64MP。
 * 用于拖拽时给出可见反馈，而不是等提交前才拦下。
 */
export function outpaintLimitReason(
  sourceWidth: number,
  sourceHeight: number,
  target: { width: number; height: number },
): OutpaintLimit | undefined {
  if (sourceWidth <= 0 || sourceHeight <= 0) return undefined
  const maxWidth = Math.max(1, Math.round(sourceWidth * MAX_SCALE))
  const maxHeight = Math.max(1, Math.round(sourceHeight * MAX_SCALE))
  if (target.width >= maxWidth || target.height >= maxHeight) return 'size'
  // 单边还没到上限，但再放大 1px 也收不回新尺寸，说明卡在总像素上限。
  const probe = clampOutpaintTargetSize(sourceWidth, sourceHeight, target.width + 1, target.height + 1)
  if (probe.size.width === target.width && probe.size.height === target.height) return 'pixels'
  return undefined
}
