import { BAILIAN_IMAGEEDIT_PROMPT_MAX } from './prompt-limits.js'

/** 万相 imageedit 输入边长限制。消除蒙版必须与送进模型的底图像素一一对应。 */
export const MIN_EDGE = 512
export const MAX_EDGE = 4096
export const ERASE_OVERLAY_WIDTH = 640
export const ERASE_OVERLAY_HEIGHT = 420
/** 缩放后再二值化：≥ 此亮度视为白色消除区。 */
export const MASK_WHITE_THRESHOLD = 128
/** 涂抹边缘略膨胀，减少抗锯齿灰边留下的缝。 */
export const MASK_DILATE_RADIUS = 2
export const MAX_ERASE_PROMPT_LENGTH = BAILIAN_IMAGEEDIT_PROMPT_MAX
/** 百炼 prompt 必填；空串会在服务端按字符下标读取并报 string index out of range。描述结果，不要写「删除xxx」。 */
export const DEFAULT_ERASE_PROMPT = '与周围背景自然融合的干净背景'

export interface FittedImageSize {
  width: number
  height: number
  scale: number
}

export interface ContainRect {
  x: number
  y: number
  width: number
  height: number
  scale: number
}

/** 把原图 contain 进固定预览框，与蒙版画布上的 object-fit: contain 一致。 */
export function containRect(sourceWidth: number, sourceHeight: number, boxWidth: number, boxHeight: number): ContainRect {
  if (sourceWidth < 1 || sourceHeight < 1 || boxWidth < 1 || boxHeight < 1) {
    return { x: 0, y: 0, width: 0, height: 0, scale: 0 }
  }
  const scale = Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight)
  const width = Math.min(boxWidth, Math.max(1, Math.round(sourceWidth * scale)))
  const height = Math.min(boxHeight, Math.max(1, Math.round(sourceHeight * scale)))
  return {
    x: Math.floor((boxWidth - width) / 2),
    y: Math.floor((boxHeight - height) / 2),
    width,
    height,
    scale,
  }
}

/**
 * 边长落到 512–4096。与扩图 fittedInput 同一套几何，消除缩放蒙版时必须用同一结果。
 */
export function fitDashScopeImageSize(width: number, height: number): FittedImageSize {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error('原图尺寸无效')
  }
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
    scale *= down
  }
  if (fittedWidth < MIN_EDGE || fittedHeight < MIN_EDGE || fittedWidth > MAX_EDGE || fittedHeight > MAX_EDGE) {
    throw new Error('原图宽高比超出图像编辑服务可接受的范围')
  }
  return { width: fittedWidth, height: fittedHeight, scale }
}

/** RGBA：涂抹画布上 alpha>0 视为选区（与现有 exportPaintedMask 一致）。 */
export function thresholdPaintedOverlay(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Uint8Array {
  const pixels = width * height
  const out = new Uint8Array(pixels)
  for (let i = 0; i < pixels; i += 1) {
    out[i] = rgba[i * 4 + 3] > 0 ? 255 : 0
  }
  return out
}

/** RGBA 或灰度：亮度（或单通道）≥ 阈值 → 白，否则黑。去掉抗锯齿灰边。 */
export function thresholdMask(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  channels: 1 | 3 | 4 = 4,
  threshold = MASK_WHITE_THRESHOLD,
): Uint8Array {
  const pixels = width * height
  const out = new Uint8Array(pixels)
  for (let i = 0; i < pixels; i += 1) {
    const offset = i * channels
    const luma = channels === 1
      ? data[offset]
      : Math.round(0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2])
    out[i] = luma >= threshold ? 255 : 0
  }
  return out
}

/** 最近邻缩放二值蒙版，再按阈值收成纯黑白（避免插值灰）。 */
export function scaleMaskNearest(
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  threshold = MASK_WHITE_THRESHOLD,
): Uint8Array {
  if (sourceWidth < 1 || sourceHeight < 1 || targetWidth < 1 || targetHeight < 1) {
    throw new Error('蒙版尺寸无效')
  }
  if (sourceWidth === targetWidth && sourceHeight === targetHeight) {
    return thresholdMask(source, sourceWidth, sourceHeight, 1, threshold)
  }
  const out = new Uint8Array(targetWidth * targetHeight)
  for (let y = 0; y < targetHeight; y += 1) {
    const srcY = Math.min(sourceHeight - 1, Math.floor((y + 0.5) * sourceHeight / targetHeight))
    for (let x = 0; x < targetWidth; x += 1) {
      const srcX = Math.min(sourceWidth - 1, Math.floor((x + 0.5) * sourceWidth / targetWidth))
      out[y * targetWidth + x] = source[srcY * sourceWidth + srcX] >= threshold ? 255 : 0
    }
  }
  return out
}

/** 方形核膨胀：白色消除区向外扩 radius 像素，便于把灰边吃掉。 */
export function dilateMask(mask: Uint8Array, width: number, height: number, radius = MASK_DILATE_RADIUS): Uint8Array {
  if (radius <= 0) return new Uint8Array(mask)
  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let white = false
      const y0 = Math.max(0, y - radius)
      const y1 = Math.min(height - 1, y + radius)
      const x0 = Math.max(0, x - radius)
      const x1 = Math.min(width - 1, x + radius)
      for (let yy = y0; yy <= y1 && !white; yy += 1) {
        const row = yy * width
        for (let xx = x0; xx <= x1; xx += 1) {
          if (mask[row + xx] >= MASK_WHITE_THRESHOLD) {
            white = true
            break
          }
        }
      }
      out[y * width + x] = white ? 255 : 0
    }
  }
  return out
}

/**
 * 把 640×420 涂抹层映射到原图像素：只取 contain 区域内的笔划，最近邻落到 imageW×imageH。
 */
export function mapOverlayMaskToImage(
  overlay: Uint8Array,
  overlayWidth: number,
  overlayHeight: number,
  imageWidth: number,
  imageHeight: number,
): Uint8Array {
  const rect = containRect(imageWidth, imageHeight, overlayWidth, overlayHeight)
  const out = new Uint8Array(imageWidth * imageHeight)
  if (rect.width < 1 || rect.height < 1) return out
  const region = new Uint8Array(rect.width * rect.height)
  for (let y = 0; y < rect.height; y += 1) {
    const srcRow = (rect.y + y) * overlayWidth + rect.x
    region.set(overlay.subarray(srcRow, srcRow + rect.width), y * rect.width)
  }
  return scaleMaskNearest(region, rect.width, rect.height, imageWidth, imageHeight)
}

export function maskPaintedPixelCount(mask: Uint8Array, threshold = MASK_WHITE_THRESHOLD): number {
  let count = 0
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i] >= threshold) count += 1
  }
  return count
}

export function maskHasEraseRegion(
  mask: Uint8Array,
  threshold = MASK_WHITE_THRESHOLD,
  minPixels = 1,
): boolean {
  return maskPaintedPixelCount(mask, threshold) >= minPixels
}

export function binaryMaskToRgba(mask: Uint8Array): Uint8Array {
  const rgba = new Uint8Array(mask.length * 4)
  for (let i = 0; i < mask.length; i += 1) {
    const value = mask[i] >= MASK_WHITE_THRESHOLD ? 255 : 0
    const offset = i * 4
    rgba[offset] = value
    rgba[offset + 1] = value
    rgba[offset + 2] = value
    rgba[offset + 3] = 255
  }
  return rgba
}

export function trimErasePrompt(prompt?: string | null): string {
  return (prompt ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_ERASE_PROMPT_LENGTH)
}

/** 用户有背景描述就用原文；留空则换成可提交的默认结果描述。 */
export function normalizeErasePrompt(prompt?: string | null): string {
  return trimErasePrompt(prompt) || DEFAULT_ERASE_PROMPT
}
