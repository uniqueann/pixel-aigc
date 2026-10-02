import { containRect, dilateMask } from './erase.js'

/** 数据万象商品抠图：PNG/JPEG，不超过 10MB，边长 32–7680×4320。见文档 460/36620。 */
export const GOODS_MATTING_MAX_WIDTH = 7680
export const GOODS_MATTING_MAX_HEIGHT = 4320
export const GOODS_MATTING_MIN_EDGE = 32
export const GOODS_MATTING_MAX_BYTES = 10 * 1024 * 1024
/** 选区不需要原图像素级精度；缩小后再送腾讯云，缩短 pdx1→COS 传输和抠图时间。 */
export const GOODS_MATTING_WORKING_MAX_EDGE = 1280
export const ALPHA_THRESHOLD = 128
export const SELECT_DILATE_RADIUS = 4
export const SELECT_FEATHER_RADIUS = 2
/** 几乎铺满全图时，抠图没有把商品和背景分开。 */
export const MAX_SUBJECT_RATIO = 0.985
export const MIN_SUBJECT_PIXELS = 16
export const SMART_SELECT_MISS_CODE = 'SMART_SELECT_MISS'
export const SMART_SELECT_MISS_MESSAGE = '没有点中商品，请点在商品上。水印和文字请用画笔'

export interface SegmentSession {
  provider: string
  payload: string
}

export interface NormPoint {
  x: number
  y: number
}

export interface NormBox {
  x: number
  y: number
  width: number
  height: number
}

export interface PixelRect {
  x: number
  y: number
  width: number
  height: number
}

export type SelectionError = 'miss' | 'full-frame'

export function fitMattingSize(width: number, height: number) {
  if (width < GOODS_MATTING_MIN_EDGE || height < GOODS_MATTING_MIN_EDGE) {
    throw new Error('IMAGE_TOO_SMALL')
  }
  const scale = Math.min(1, GOODS_MATTING_MAX_WIDTH / width, GOODS_MATTING_MAX_HEIGHT / height)
  let fittedWidth = Math.round(width * scale)
  let fittedHeight = Math.round(height * scale)
  fittedWidth = Math.min(GOODS_MATTING_MAX_WIDTH, Math.max(GOODS_MATTING_MIN_EDGE, fittedWidth))
  fittedHeight = Math.min(GOODS_MATTING_MAX_HEIGHT, Math.max(GOODS_MATTING_MIN_EDGE, fittedHeight))
  return { width: fittedWidth, height: fittedHeight, scale }
}

/** 硬限制之内再收到工作边长，点击坐标仍是 0–1，蒙版会拉伸回预览框。 */
export function fitMattingWorkingSize(width: number, height: number) {
  const fitted = fitMattingSize(width, height)
  const longest = Math.max(fitted.width, fitted.height)
  const scale = Math.min(1, GOODS_MATTING_WORKING_MAX_EDGE / longest)
  if (scale >= 1) return fitted
  return {
    width: Math.max(GOODS_MATTING_MIN_EDGE, Math.round(fitted.width * scale)),
    height: Math.max(GOODS_MATTING_MIN_EDGE, Math.round(fitted.height * scale)),
    scale: fitted.scale * scale,
  }
}

/** 点击换算到原图 0–1。落在 contain 留白上时返回 null，调用方不应请求接口。 */
export function sourcePoint(
  sceneX: number,
  sceneY: number,
  sourceWidth: number,
  sourceHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): NormPoint | null {
  const rect = containRect(sourceWidth, sourceHeight, canvasWidth, canvasHeight)
  if (rect.width < 1 || rect.height < 1) return null
  if (sceneX < rect.x || sceneY < rect.y || sceneX >= rect.x + rect.width || sceneY >= rect.y + rect.height) return null
  const clamp = (value: number) => Math.min(1, Math.max(0, Math.round(value * 1e6) / 1e6))
  return {
    x: clamp((sceneX - rect.x) / rect.width),
    y: clamp((sceneY - rect.y) / rect.height),
  }
}

export function binarizeAlpha(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  channels: 1 | 4 = 4,
) {
  const out = new Uint8Array(width * height)
  for (let index = 0; index < out.length; index += 1) {
    const value = channels === 1 ? data[index] : data[index * 4 + 3]
    out[index] = value >= ALPHA_THRESHOLD ? 255 : 0
  }
  return out
}

export function pointToPixel(point: NormPoint, width: number, height: number) {
  return {
    x: Math.min(width - 1, Math.max(0, Math.floor(point.x * width))),
    y: Math.min(height - 1, Math.max(0, Math.floor(point.y * height))),
  }
}

function pixelRect(box: NormBox, width: number, height: number) {
  const x0 = Math.min(width - 1, Math.max(0, Math.floor(box.x * width)))
  const y0 = Math.min(height - 1, Math.max(0, Math.floor(box.y * height)))
  const x1 = Math.min(width, Math.max(x0 + 1, Math.ceil((box.x + box.width) * width)))
  const y1 = Math.min(height, Math.max(y0 + 1, Math.ceil((box.y + box.height) * height)))
  return { x0, y0, x1, y1 }
}

/** 8 连通。商品抠图文档只说返回商品区域，没有保证只有一个主体。 */
export function labelComponents(binary: Uint8Array, width: number, height: number) {
  const labels = new Int32Array(width * height)
  const parent = [0]
  const find = (id: number) => {
    let current = id
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]]
      current = parent[current]
    }
    return current
  }
  const unite = (left: number, right: number) => {
    const a = find(left)
    const b = find(right)
    if (a !== b) parent[b] = a
  }
  let next = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      if (binary[index] < ALPHA_THRESHOLD) continue
      let label = 0
      for (let dy = -1; dy <= 0; dy += 1) {
        for (let dx = -1; dx <= (dy === 0 ? -1 : 1); dx += 1) {
          const ny = y + dy
          const nx = x + dx
          if (ny < 0 || nx < 0 || nx >= width) continue
          const neighbor = labels[ny * width + nx]
          if (!neighbor) continue
          if (!label) label = neighbor
          else unite(label, neighbor)
        }
      }
      if (!label) {
        next += 1
        parent[next] = next
        label = next
      }
      labels[index] = label
    }
  }
  for (let index = 0; index < labels.length; index += 1) {
    if (labels[index]) labels[index] = find(labels[index])
  }
  return labels
}

function extractLabel(labels: Int32Array, label: number) {
  const out = new Uint8Array(labels.length)
  let count = 0
  for (let index = 0; index < labels.length; index += 1) {
    if (labels[index] !== label) continue
    out[index] = 255
    count += 1
  }
  return { mask: out, count }
}

function clipToBox(mask: Uint8Array, width: number, height: number, box: NormBox) {
  const rect = pixelRect(box, width, height)
  const out = new Uint8Array(mask.length)
  let count = 0
  for (let y = rect.y0; y < rect.y1; y += 1) {
    for (let x = rect.x0; x < rect.x1; x += 1) {
      const index = y * width + x
      if (mask[index] < ALPHA_THRESHOLD) continue
      out[index] = 255
      count += 1
    }
  }
  return { mask: out, count }
}

function labelOverlappingBox(labels: Int32Array, width: number, height: number, box: NormBox) {
  const rect = pixelRect(box, width, height)
  const counts = new Map<number, number>()
  for (let y = rect.y0; y < rect.y1; y += 1) {
    for (let x = rect.x0; x < rect.x1; x += 1) {
      const label = labels[y * width + x]
      if (!label) continue
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
  }
  let best = 0
  let bestCount = 0
  for (const [label, count] of counts) {
    if (count > bestCount) {
      best = label
      bestCount = count
    }
  }
  return best
}

/**
 * 先取包含点击的连通域。检测框只在点落在背景上、或两块商品粘在一起时用来收窄。
 * 返回的是二值化、膨胀、羽化之后的 alpha。
 */
export function buildSelectionAlpha(
  binary: Uint8Array,
  width: number,
  height: number,
  point: NormPoint,
  box?: NormBox,
): { alpha: Uint8Array } | { error: SelectionError } {
  const labels = labelComponents(binary, width, height)
  const pixel = pointToPixel(point, width, height)
  let label = labels[pixel.y * width + pixel.x]
  if (!label && box) label = labelOverlappingBox(labels, width, height, box)
  if (!label) return { error: 'miss' }
  let picked = extractLabel(labels, label)
  if (box) {
    const clipped = clipToBox(picked.mask, width, height, box)
    if (clipped.count > 0) picked = clipped
  }
  if (picked.count < MIN_SUBJECT_PIXELS) return { error: 'miss' }
  if (picked.count / (width * height) > MAX_SUBJECT_RATIO) return { error: 'full-frame' }
  const grown = dilateMask(picked.mask, width, height, SELECT_DILATE_RADIUS)
  return { alpha: featherAlpha(grown, width, height, SELECT_FEATHER_RADIUS) }
}

/** 可分离盒式模糊。实心区域保持不透明，边缘向外淡出几个像素。 */
export function featherAlpha(mask: Uint8Array, width: number, height: number, radius: number) {
  if (radius <= 0) return new Uint8Array(mask)
  const horizontal = new Float32Array(width * height)
  for (let y = 0; y < height; y += 1) {
    const prefix = new Float32Array(width + 1)
    for (let x = 0; x < width; x += 1) {
      prefix[x + 1] = prefix[x] + (mask[y * width + x] >= ALPHA_THRESHOLD ? 1 : 0)
    }
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius)
      const x1 = Math.min(width - 1, x + radius)
      horizontal[y * width + x] = (prefix[x1 + 1] - prefix[x0]) / (x1 - x0 + 1)
    }
  }
  const out = new Uint8Array(width * height)
  for (let x = 0; x < width; x += 1) {
    const prefix = new Float32Array(height + 1)
    for (let y = 0; y < height; y += 1) prefix[y + 1] = prefix[y] + horizontal[y * width + x]
    for (let y = 0; y < height; y += 1) {
      const y0 = Math.max(0, y - radius)
      const y1 = Math.min(height - 1, y + radius)
      const value = (prefix[y1 + 1] - prefix[y0]) / (y1 - y0 + 1)
      out[y * width + x] = Math.max(0, Math.min(255, Math.round(value * 255)))
    }
  }
  return out
}

export function alphaBBox(alpha: Uint8Array, width: number, height: number): NormBox | null {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alpha[y * width + x] === 0) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  if (maxX < minX || maxY < minY) return null
  const round = (value: number) => Math.round(value * 1e6) / 1e6
  return {
    x: round(minX / width),
    y: round(minY / height),
    width: round((maxX - minX + 1) / width),
    height: round((maxY - minY + 1) / height),
  }
}

export function scaleAlphaNearest(
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
) {
  if (sourceWidth === targetWidth && sourceHeight === targetHeight) return new Uint8Array(source)
  const out = new Uint8Array(targetWidth * targetHeight)
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y + 0.5) * sourceHeight / targetHeight))
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x + 0.5) * sourceWidth / targetWidth))
      out[y * targetWidth + x] = source[sourceY * sourceWidth + sourceX]
    }
  }
  return out
}

export function opaqueCount(rgba: ArrayLike<number>, width: number, height: number, rect: PixelRect) {
  const x0 = Math.max(0, rect.x)
  const y0 = Math.max(0, rect.y)
  const x1 = Math.min(width, rect.x + rect.width)
  const y1 = Math.min(height, rect.y + rect.height)
  let count = 0
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (rgba[(y * width + x) * 4 + 3] > 0) count += 1
    }
  }
  return count
}

/** 涂抹层预览色，与画笔 `rgba(220, 38, 38, 0.5)` 一致。 */
export const MASK_PAINT_RGB = { r: 220, g: 38, b: 38 }
export const MASK_PAINT_ALPHA = 128
export const MASK_PAINT_CSS = 'rgba(220, 38, 38, 0.5)'

/** 把任意颜色的透明蒙版改成和画笔相同的半透明红。 */
export function tintOverlayAsBrush(rgba: Uint8Array | Uint8ClampedArray) {
  for (let index = 0; index < rgba.length; index += 4) {
    const alpha = rgba[index + 3]
    if (alpha === 0) continue
    rgba[index] = MASK_PAINT_RGB.r
    rgba[index + 1] = MASK_PAINT_RGB.g
    rgba[index + 2] = MASK_PAINT_RGB.b
    rgba[index + 3] = Math.max(1, Math.round(alpha * MASK_PAINT_ALPHA / 255))
  }
}

/** 只反转图片矩形内的选区，留白保持透明。新选区用画笔同色。 */
export function invertContainedAlpha(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, rect: PixelRect) {
  const x0 = Math.max(0, rect.x)
  const y0 = Math.max(0, rect.y)
  const x1 = Math.min(width, rect.x + rect.width)
  const y1 = Math.min(height, rect.y + rect.height)
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const offset = (y * width + x) * 4
      if (rgba[offset + 3] > 0) {
        rgba[offset + 3] = 0
      } else {
        rgba[offset] = MASK_PAINT_RGB.r
        rgba[offset + 1] = MASK_PAINT_RGB.g
        rgba[offset + 2] = MASK_PAINT_RGB.b
        rgba[offset + 3] = MASK_PAINT_ALPHA
      }
    }
  }
}
