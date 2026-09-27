import {
  binaryMaskToRgba,
  mapOverlayMaskToImage,
  maskHasEraseRegion,
  thresholdPaintedOverlay,
} from '../../../../shared/erase'

export const EMPTY_ERASE_MASK_MESSAGE = '请先涂抹要消除的区域'
export const EMPTY_REPAINT_MASK_MESSAGE = '请先涂抹要重绘的区域'
/** 排除误触的一两个像素，要求至少有一小段笔划。 */
export const MIN_MASK_PIXELS = 32

export function emptyMaskMessage(mode?: 'remove' | 'repaint') {
  return mode === 'repaint' ? EMPTY_REPAINT_MASK_MESSAGE : EMPTY_ERASE_MASK_MESSAGE
}

export function remapMaskExportError(error: unknown, mode?: 'remove' | 'repaint') {
  if (error instanceof Error && error.message === EMPTY_ERASE_MASK_MESSAGE) {
    return new Error(emptyMaskMessage(mode))
  }
  return error instanceof Error ? error : new Error('蒙版导出失败')
}

export interface MaskExportResult {
  /** 黑白蒙版：白色表示待生成区域，黑色表示保留区域 */
  maskDataUrl: string
  width: number
  height: number
}

/**
 * 消除/重绘用：将 Fabric 透明画布规范化为严格的黑白蒙版。
 * 任何非透明像素都视为用户涂抹区域，橡皮擦产生的透明像素会恢复为黑色。
 */
export function exportPaintedMask(maskCanvasEl: HTMLCanvasElement): MaskExportResult {
  const width = maskCanvasEl.width
  const height = maskCanvasEl.height
  const sourceContext = maskCanvasEl.getContext('2d')
  const outputCanvas = document.createElement('canvas')
  outputCanvas.width = width
  outputCanvas.height = height
  const outputContext = outputCanvas.getContext('2d')

  if (!sourceContext || !outputContext) {
    throw new Error('当前浏览器不支持画布蒙版导出')
  }

  const sourcePixels = sourceContext.getImageData(0, 0, width, height)
  const overlay = thresholdPaintedOverlay(sourcePixels.data, width, height)
  if (!maskHasEraseRegion(overlay, undefined, MIN_MASK_PIXELS)) throw new Error(EMPTY_ERASE_MASK_MESSAGE)
  const outputPixels = outputContext.createImageData(width, height)

  for (let index = 0; index < overlay.length; index += 1) {
    const value = overlay[index] >= 128 ? 255 : 0
    const offset = index * 4
    outputPixels.data[offset] = value
    outputPixels.data[offset + 1] = value
    outputPixels.data[offset + 2] = value
    outputPixels.data[offset + 3] = 255
  }

  outputContext.putImageData(outputPixels, 0, 0)
  return { maskDataUrl: outputCanvas.toDataURL('image/png'), width, height }
}

/**
 * 消除用：把 640×420 contain 涂抹层映射到原图像素，再收成纯黑白 PNG。
 * 预览黑边里的笔划不会进蒙版。
 */
export function exportEraseMask(
  maskCanvasEl: HTMLCanvasElement,
  imageNaturalSize: { width: number; height: number },
): MaskExportResult {
  const width = maskCanvasEl.width
  const height = maskCanvasEl.height
  const sourceContext = maskCanvasEl.getContext('2d')
  if (!sourceContext) throw new Error('当前浏览器不支持画布蒙版导出')
  if (imageNaturalSize.width < 1 || imageNaturalSize.height < 1) throw new Error('无法读取原图尺寸')
  const sourcePixels = sourceContext.getImageData(0, 0, width, height)
  const overlay = thresholdPaintedOverlay(sourcePixels.data, width, height)
  if (!maskHasEraseRegion(overlay, undefined, MIN_MASK_PIXELS)) throw new Error(EMPTY_ERASE_MASK_MESSAGE)
  const mapped = mapOverlayMaskToImage(overlay, width, height, imageNaturalSize.width, imageNaturalSize.height)
  if (!maskHasEraseRegion(mapped, undefined, MIN_MASK_PIXELS)) throw new Error(EMPTY_ERASE_MASK_MESSAGE)
  const outputCanvas = document.createElement('canvas')
  outputCanvas.width = imageNaturalSize.width
  outputCanvas.height = imageNaturalSize.height
  const outputContext = outputCanvas.getContext('2d')
  if (!outputContext) throw new Error('当前浏览器不支持画布蒙版导出')
  const outputPixels = outputContext.createImageData(imageNaturalSize.width, imageNaturalSize.height)
  outputPixels.data.set(binaryMaskToRgba(mapped))
  outputContext.putImageData(outputPixels, 0, 0)
  return {
    maskDataUrl: outputCanvas.toDataURL('image/png'),
    width: imageNaturalSize.width,
    height: imageNaturalSize.height,
  }
}

/** 扩图用：根据目标尺寸和原图位置计算黑白蒙版 */
export function computeOutpaintMask(
  targetSize: { width: number; height: number },
  originOffset: { x: number; y: number },
  imageNaturalSize: { width: number; height: number },
): MaskExportResult {
  const canvas = document.createElement('canvas')
  canvas.width = targetSize.width
  canvas.height = targetSize.height
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('当前浏览器不支持画布蒙版导出')
  }

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, targetSize.width, targetSize.height)
  context.fillStyle = '#000000'
  context.fillRect(originOffset.x, originOffset.y, imageNaturalSize.width, imageNaturalSize.height)

  return {
    maskDataUrl: canvas.toDataURL('image/png'),
    width: targetSize.width,
    height: targetSize.height,
  }
}
