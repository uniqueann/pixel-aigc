import { watermarkPosition, watermarkTilePositions } from './geometry'
import type { WatermarkSettings } from './types'

type DrawContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export function drawWatermarkedImage(
  context: DrawContext,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  settings: WatermarkSettings,
  logo?: CanvasImageSource & { width: number; height: number },
) {
  context.clearRect(0, 0, targetWidth, targetHeight)
  context.drawImage(source, 0, 0, targetWidth, targetHeight)
  const scale = targetWidth / sourceWidth
  const shortSide = Math.min(sourceWidth, sourceHeight)
  const margin = shortSide * settings.marginPercent / 100 * scale
  context.save()
  context.globalAlpha = settings.opacity / 100

  function drawMark(width: number, height: number, draw: (left: number, top: number) => void) {
    if (settings.layout === 'tile') {
      const gap = shortSide * settings.tileGapPercent / 100 * scale
      context.save()
      context.translate(targetWidth / 2, targetHeight / 2)
      context.rotate(settings.tileRotation * Math.PI / 180)
      for (const point of watermarkTilePositions(targetWidth, targetHeight, width, height, gap, settings.tileRotation)) {
        draw(point.left, point.top)
      }
      context.restore()
      return
    }
    const point = watermarkPosition(targetWidth, targetHeight, width, height, margin, settings.anchor)
    draw(point.left, point.top)
  }

  if (settings.kind === 'logo' && logo) {
    const fullMargin = shortSide * settings.marginPercent / 100
    const fullWidth = Math.min(
      shortSide * settings.logoSizePercent / 100,
      logo.width,
      sourceWidth - 2 * fullMargin,
      (sourceHeight - 2 * fullMargin) * logo.width / logo.height,
    )
    const width = fullWidth * scale
    const height = width * logo.height / logo.width
    drawMark(width, height, (left, top) => context.drawImage(logo, left, top, width, height))
  }

  if (settings.kind === 'text' && settings.text.trim()) {
    const text = settings.text.trim()
    let fontSize = shortSide * settings.textSizePercent / 100 * scale
    context.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif`
    const availableWidth = Math.max(1, targetWidth - 2 * margin)
    const measuredWidth = context.measureText(text).width
    if (measuredWidth > availableWidth) {
      fontSize *= availableWidth / measuredWidth
      context.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif`
    }
    const width = Math.min(availableWidth, context.measureText(text).width)
    const height = fontSize * 1.15
    context.textBaseline = 'top'
    context.fillStyle = settings.color
    context.shadowColor = 'rgba(0, 0, 0, 0.55)'
    context.shadowBlur = Math.max(1, fontSize * 0.1)
    context.shadowOffsetY = Math.max(1, fontSize * 0.04)
    drawMark(width, height, (left, top) => context.fillText(text, left, top))
  }
  context.restore()
}
