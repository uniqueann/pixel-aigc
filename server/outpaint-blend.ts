import sharp from 'sharp'
import type { PixelPadding } from '../shared/outpaint.js'

interface Pixels { data: Buffer; width: number; height: number; channels: 3 | 4; read?: (x: number, y: number, channel: number) => number }
type Side = keyof PixelPadding
interface Edge { side: Side; width: number; length: number; offsets: number[][] }
interface Rect { left: number; top: number; width: number; height: number }
const HALO = 96
const TILE_LENGTH = 512
const SEGMENT = 256
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))
const smooth = (value: number) => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t) }

function sourcePixel(source: Pixels, x: number, y: number, channel: number, background: number) {
  const i = (clamp(y, 0, source.height - 1) * source.width + clamp(x, 0, source.width - 1)) * source.channels
  const alpha = source.channels === 4 ? source.data[i + 3] / 255 : 1
  return source.data[i + channel] * alpha + background * (1 - alpha)
}

function sidePoint(side: Side, distance: number, along: number, source: Pixels, padding: PixelPadding) {
  if (side === 'left') return { x: padding.left + distance, y: padding.top + along }
  if (side === 'right') return { x: padding.left + source.width - 1 - distance, y: padding.top + along }
  if (side === 'top') return { x: padding.left + along, y: padding.top + distance }
  return { x: padding.left + along, y: padding.top + source.height - 1 - distance }
}

function distanceToEdge(side: Side, x: number, y: number, source: Pixels, padding: PixelPadding) {
  if (side === 'left') return x - padding.left
  if (side === 'right') return padding.left + source.width - 1 - x
  if (side === 'top') return y - padding.top
  return padding.top + source.height - 1 - y
}

function alongEdge(side: Side, x: number, y: number, padding: PixelPadding) {
  return side === 'left' || side === 'right' ? y - padding.top : x - padding.left
}

function pixelAt(image: Pixels, x: number, y: number, channel: number) {
  return image.read ? image.read(x, y, channel) : image.data[(y * image.width + x) * 3 + channel]
}

function rawPatch(image: Pixels, rect: Rect) {
  const data = Buffer.alloc(rect.width * rect.height * 3)
  if (image.read) {
    for (let y = 0; y < rect.height; y += 1) for (let x = 0; x < rect.width; x += 1) for (let c = 0; c < 3; c += 1) {
      data[(y * rect.width + x) * 3 + c] = pixelAt(image, rect.left + x, rect.top + y, c)
    }
    return data
  }
  for (let y = 0; y < rect.height; y += 1) {
    image.data.copy(data, y * rect.width * 3, ((rect.top + y) * image.width + rect.left) * 3,
      ((rect.top + y) * image.width + rect.left + rect.width) * 3)
  }
  return data
}

function sourcePatch(source: Pixels, background: Pixels, rect: Rect, padding: PixelPadding) {
  const data = Buffer.alloc(rect.width * rect.height * 3)
  for (let y = 0; y < rect.height; y += 1) for (let x = 0; x < rect.width; x += 1) {
    const i = (y * rect.width + x) * 3
    for (let c = 0; c < 3; c += 1) data[i + c] = Math.round(sourcePixel(source, rect.left + x - padding.left,
      rect.top + y - padding.top, c, pixelAt(background, rect.left + x, rect.top + y, c)))
  }
  return data
}

function blur(data: Buffer, rect: Rect, sigma: number) {
  return sharp(data, { raw: { width: rect.width, height: rect.height, channels: 3 } }).blur(sigma).raw().toBuffer()
}

async function matchEdge(edge: Edge, source: Pixels, background: Pixels, padding: PixelPadding) {
  const depth = Math.min(32, edge.width)
  for (let along = 0; along < edge.length; along += SEGMENT) {
    const length = Math.min(SEGMENT, edge.length - along)
    const start = sidePoint(edge.side, 0, along, source, padding)
    const vertical = edge.side === 'left' || edge.side === 'right'
    const rect = { left: start.x - (edge.side === 'right' ? depth - 1 : 0),
      top: start.y - (edge.side === 'bottom' ? depth - 1 : 0),
      width: vertical ? depth : length, height: vertical ? length : depth }
    const original = sourcePatch(source, background, rect, padding)
    const [a, b] = await Promise.all([blur(original, rect, 8), blur(rawPatch(background, rect), rect, 8)])
    const values: number[][] = [[], [], []]
    for (let y = 1; y < rect.height - 1; y += 2) for (let x = 1; x < rect.width - 1; x += 2) {
      const i = (y * rect.width + x) * 3
      const sx = rect.left + x - padding.left, sy = rect.top + y - padding.top
      if (source.channels === 4 && source.data[(sy * source.width + sx) * 4 + 3] < 242) continue
      let gradient = 0
      for (let c = 0; c < 3; c += 1) gradient = Math.max(gradient,
        Math.abs(original[i + c] - original[i - 3 + c]), Math.abs(original[i + c] - original[i - rect.width * 3 + c]))
      if (gradient > 16) continue
      for (let c = 0; c < 3; c += 1) values[c].push(a[i + c] - b[i + c])
    }
    edge.offsets.push(values.map(samples => samples.length < 32 ? 0 : clamp(samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)], -24, 24)))
  }
}

function correction(edges: Edge[], x: number, y: number, source: Pixels, padding: PixelPadding) {
  const result = [0, 0, 0]
  let weightSum = 0
  for (const edge of edges) {
    const distance = distanceToEdge(edge.side, x, y, source, padding)
    const along = alongEdge(edge.side, x, y, padding)
    if (Math.abs(distance) >= edge.width * 2 || along < -edge.width * 2 || along >= edge.length + edge.width * 2) continue
    const position = clamp((along - SEGMENT / 2) / SEGMENT, 0, edge.offsets.length - 1)
    const first = Math.floor(position), second = Math.min(first + 1, edge.offsets.length - 1)
    const fraction = position - first
    const weight = 1 / (Math.abs(distance) + 1)
    const fade = 1 - smooth(Math.abs(distance) / (edge.width * 2))
    for (let c = 0; c < 3; c += 1) result[c] += (edge.offsets[first][c] * (1 - fraction) + edge.offsets[second][c] * fraction) * fade * weight
    weightSum += weight
  }
  return weightSum ? result.map(value => value / weightSum) : result
}

function expandedRect(rect: Rect, background: Pixels): Rect {
  const left = Math.max(0, rect.left - HALO), top = Math.max(0, rect.top - HALO)
  return { left, top, width: Math.min(background.width, rect.left + rect.width + HALO) - left,
    height: Math.min(background.height, rect.top + rect.height + HALO) - top }
}

/** 只在边缘块上构建频段，原图内部按原像素放回；角落由统一距离权重计算。 */
export async function blendOutpaintEdges(
  source: Pixels, background: Pixels, padding: PixelPadding,
  log: (entry: Record<string, unknown>) => void = () => {},
  deadlineAt = Infinity,
  reuseBackground = false,
): Promise<Pixels> {
  if (background.width !== source.width + padding.left + padding.right || background.height !== source.height + padding.top + padding.bottom) {
    throw new Error('原图与扩图画布尺寸不一致')
  }
  const checkDeadline = () => { if (Date.now() >= deadlineAt) throw new Error('扩图合成超时，请重试') }
  const baseWidth = clamp(Math.round(Math.min(source.width, source.height) * 0.025), 64, 128)
  const edges: Edge[] = (['left', 'right', 'top', 'bottom'] as const).filter(side => padding[side] > 0).map(side => {
    const vertical = side === 'left' || side === 'right'
    return { side, width: Math.max(1, Math.min(baseWidth, Math.floor((vertical ? source.width : source.height) / 4), padding[side])),
      length: vertical ? source.height : source.width, offsets: [] }
  })
  const colorStarted = performance.now()
  for (const edge of edges) { checkDeadline(); await matchEdge(edge, source, background, padding) }
  log({ stage: 'colorMatch', ms: performance.now() - colorStarted, edges: edges.map(edge => ({ side: edge.side, width: edge.width })) })
  const started = performance.now()
  const output = reuseBackground ? background.data : Buffer.from(background.data)
  if (reuseBackground) {
    // 原地写回整图，只保存滤波和校色会读取的边缘背景，避免再复制一张大画布。
    const snapshots = edges.map(edge => {
      const vertical = edge.side === 'left' || edge.side === 'right'
      const point = sidePoint(edge.side, 0, 0, source, padding)
      const reach = Math.max(edge.width * 2, HALO)
      const left = Math.max(0, point.x - reach)
      const top = Math.max(0, point.y - reach)
      const right = Math.min(background.width, vertical ? point.x + edge.width + HALO + 1 : point.x + edge.length + reach)
      const bottom = Math.min(background.height, vertical ? point.y + edge.length + reach : point.y + edge.width + HALO + 1)
      // 右边、下边的内侧方向与左边、上边相反。
      const rect = { left: edge.side === 'right' ? Math.max(0, point.x - edge.width - HALO) : left,
        top: edge.side === 'bottom' ? Math.max(0, point.y - edge.width - HALO) : top,
        width: 0, height: 0 }
      rect.width = (edge.side === 'right' ? Math.min(background.width, point.x + reach + 1) : right) - rect.left
      rect.height = (edge.side === 'bottom' ? Math.min(background.height, point.y + reach + 1) : bottom) - rect.top
      return { rect, data: rawPatch(background, rect) }
    })
    background = { ...background, read: (x, y, channel) => {
      for (const snapshot of snapshots) {
        const rect = snapshot.rect
        if (x >= rect.left && y >= rect.top && x < rect.left + rect.width && y < rect.top + rect.height) {
          return snapshot.data[((y - rect.top) * rect.width + x - rect.left) * 3 + channel]
        }
      }
      return background.data[(y * background.width + x) * 3 + channel]
    } }
  }
  // 先恢复原图，包括透明像素与模型背景的正常合成。
  if (source.channels === 3) {
    for (let y = 0; y < source.height; y += 1) source.data.copy(output,
      ((padding.top + y) * background.width + padding.left) * 3, y * source.width * 3, (y + 1) * source.width * 3)
  } else {
    for (let y = 0; y < source.height; y += 1) for (let x = 0; x < source.width; x += 1) {
      const i = ((padding.top + y) * background.width + padding.left + x) * 3
      for (let c = 0; c < 3; c += 1) output[i + c] = Math.round(sourcePixel(source, x, y, c, pixelAt(background, padding.left + x, padding.top + y, c)))
    }
  }
  // 外侧校色也按条带处理，不扫描远离边界的新增背景。
  for (const edge of edges) {
    const vertical = edge.side === 'left' || edge.side === 'right'
    for (let along = -2 * edge.width; along < edge.length + 2 * edge.width; along += 1) {
      for (let d = -2 * edge.width; d < 0; d += 1) {
        const point = sidePoint(edge.side, d, along, source, padding)
        if (point.x < 0 || point.y < 0 || point.x >= background.width || point.y >= background.height) continue
        if (point.x >= padding.left && point.x < padding.left + source.width && point.y >= padding.top && point.y < padding.top + source.height) continue
        const offset = correction(edges, point.x, point.y, source, padding)
        const i = (point.y * background.width + point.x) * 3
        for (let c = 0; c < 3; c += 1) output[i + c] = clamp(Math.round(pixelAt(background, point.x, point.y, c) + offset[c]), 0, 255)
      }
      if (along % TILE_LENGTH === 0) checkDeadline()
    }
    for (let along = 0; along < edge.length; along += TILE_LENGTH) {
      checkDeadline()
      const length = Math.min(TILE_LENGTH, edge.length - along)
      const point = sidePoint(edge.side, 0, along, source, padding)
      const rect = { left: point.x - (edge.side === 'right' ? edge.width - 1 : 0),
        top: point.y - (edge.side === 'bottom' ? edge.width - 1 : 0),
        width: vertical ? edge.width : length, height: vertical ? length : edge.width }
      const halo = expandedRect(rect, background)
      const a = sourcePatch(source, background, halo, padding)
      const b = rawPatch(background, halo)
      for (let y = 0; y < halo.height; y += 1) for (let x = 0; x < halo.width; x += 1) {
        const offset = correction(edges, halo.left + x, halo.top + y, source, padding)
        const i = (y * halo.width + x) * 3
        for (let c = 0; c < 3; c += 1) b[i + c] = clamp(Math.round(b[i + c] + offset[c]), 0, 255)
      }
      // 三组低通差构成频段，越细的纹理越早恢复原图，避免整条过渡带糊化。
      const aLevels: Buffer[] = [a], bLevels: Buffer[] = [b]
      for (const sigma of [2, 8, 32]) {
        const [aa, bb] = await Promise.all([blur(a, halo, sigma), blur(b, halo, sigma)])
        aLevels.push(aa); bLevels.push(bb)
      }
      for (let y = 0; y < rect.height; y += 1) for (let x = 0; x < rect.width; x += 1) {
        const tx = rect.left + x, ty = rect.top + y
        let t = 1
        for (const active of edges) t = Math.min(t, Math.max(0, distanceToEdge(active.side, tx, ty, source, padding)) / active.width)
        const weights = [smooth(t * 4), smooth(t * 2), smooth(t), smooth(t)]
        const i = ((ty - halo.top) * halo.width + tx - halo.left) * 3
        const out = (ty * background.width + tx) * 3
        for (let c = 0; c < 3; c += 1) {
          let value = 0
          for (let level = 0; level < 4; level += 1) {
            const aa = aLevels[level][i + c] - (level < 3 ? aLevels[level + 1][i + c] : 0)
            const bb = bLevels[level][i + c] - (level < 3 ? bLevels[level + 1][i + c] : 0)
            value += weights[level] * aa + (1 - weights[level]) * bb
          }
          output[out + c] = clamp(Math.round(value), 0, 255)
        }
      }
    }
  }
  log({ stage: 'seamBlend', ms: performance.now() - started, bandWidths: Object.fromEntries(edges.map(edge => [edge.side, edge.width])) })
  return { data: output, width: background.width, height: background.height, channels: 3 }
}
