import type { WatermarkColorMode } from './types'

/** 背景明暗的分界：高于此值时深色字对比度更高。 */
export const LUMINANCE_SPLIT = 0.179
export const LIGHT_TEXT = '#ffffff'
export const DARK_TEXT = '#141414'

export interface SampleRect {
  x: number
  y: number
  width: number
  height: number
}

export interface TextAppearance {
  fill: string
  stroke: string | null
  strokeWidth: number
}

function srgbToLinear(channel: number) {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

/** 像素合成到白色后再算相对亮度。透明像素按浅色展示面处理。 */
export function pixelLuminance(r: number, g: number, b: number, a: number) {
  const alpha = Math.min(1, Math.max(0, a / 255))
  const red = r * alpha + 255 * (1 - alpha)
  const green = g * alpha + 255 * (1 - alpha)
  const blue = b * alpha + 255 * (1 - alpha)
  return 0.2126 * srgbToLinear(red) + 0.7152 * srgbToLinear(green) + 0.0722 * srgbToLinear(blue)
}

export function averageLuminance(data: ArrayLike<number>, width: number, height: number) {
  if (width <= 0 || height <= 0 || data.length < width * height * 4) return 1
  const stride = Math.max(1, Math.ceil(Math.sqrt((width * height) / 4096)))
  let sum = 0
  let count = 0
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const index = (y * width + x) * 4
      sum += pixelLuminance(data[index], data[index + 1], data[index + 2], data[index + 3])
      count += 1
    }
  }
  return count === 0 ? 1 : sum / count
}

export function chooseTextColor(backgroundLuminance: number) {
  return backgroundLuminance >= LUMINANCE_SPLIT ? DARK_TEXT : LIGHT_TEXT
}

export function parseHexColor(value: string) {
  const match = /^#([0-9a-fA-F]{6})$/.exec(value.trim())
  if (!match) return null
  const hex = Number.parseInt(match[1], 16)
  return { r: (hex >> 16) & 255, g: (hex >> 8) & 255, b: hex & 255 }
}

/** 浅色字配深色描边，深色字配浅色描边。无法识别的颜色用深色描边。 */
export function contrastingStrokeColor(fill: string) {
  const rgb = parseHexColor(fill)
  if (!rgb) return '#000000'
  return pixelLuminance(rgb.r, rgb.g, rgb.b, 255) >= LUMINANCE_SPLIT ? '#000000' : '#ffffff'
}

/** 细描边，约为字号的 12%，至少 1px，预览缩小时仍能看见。 */
export function textStrokeWidth(fontSize: number) {
  if (!Number.isFinite(fontSize) || fontSize <= 0) return 1
  return Math.max(1, fontSize * 0.12)
}

export function clampSampleRect(left: number, top: number, width: number, height: number, canvasWidth: number, canvasHeight: number): SampleRect {
  if (canvasWidth < 1 || canvasHeight < 1) return { x: 0, y: 0, width: 0, height: 0 }
  const x = Math.max(0, Math.min(canvasWidth - 1, Math.floor(left)))
  const y = Math.max(0, Math.min(canvasHeight - 1, Math.floor(top)))
  const right = Math.max(x + 1, Math.min(canvasWidth, Math.ceil(left + Math.max(width, 0))))
  const bottom = Math.max(y + 1, Math.min(canvasHeight, Math.ceil(top + Math.max(height, 0))))
  return { x, y, width: right - x, height: bottom - y }
}

export function resolveTextAppearance(input: {
  colorMode: WatermarkColorMode
  color: string
  readability: boolean
  fontSize: number
  luminance: number | null
}): TextAppearance {
  const fill = input.colorMode === 'auto' ? chooseTextColor(input.luminance ?? 1) : input.color
  return {
    fill,
    stroke: input.readability ? contrastingStrokeColor(fill) : null,
    strokeWidth: textStrokeWidth(input.fontSize),
  }
}
