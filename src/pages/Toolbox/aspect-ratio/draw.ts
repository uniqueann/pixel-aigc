import { containRect, coverCrop, sameAspect } from './geometry'
import type { AspectRatioSettings } from './types'

type DrawContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export function drawFittedImage(
  context: DrawContext,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  settings: Pick<AspectRatioSettings, 'strategy' | 'background' | 'fx' | 'fy'>,
) {
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  if (settings.strategy === 'letterbox' && settings.background !== 'transparent') {
    context.fillStyle = settings.background
    context.fillRect(0, 0, targetWidth, targetHeight)
  } else if (settings.strategy !== 'crop') {
    context.clearRect(0, 0, targetWidth, targetHeight)
  }

  if (sameAspect(sourceWidth, sourceHeight, targetWidth, targetHeight)) {
    context.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight)
    return
  }

  if (settings.strategy === 'crop') {
    const crop = coverCrop(sourceWidth, sourceHeight, targetWidth, targetHeight, settings.fx, settings.fy)
    context.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, targetWidth, targetHeight)
    return
  }

  const fitted = containRect(sourceWidth, sourceHeight, targetWidth, targetHeight)
  context.drawImage(source, 0, 0, sourceWidth, sourceHeight, fitted.x, fitted.y, fitted.width, fitted.height)
}
