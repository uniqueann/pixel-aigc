import { i18n } from '@/i18n'
import zhErrors from '@/i18n/locales/zh-CN/errors.json'
import {
  binaryMaskToRgba,
  mapOverlayMaskToImage,
  maskHasEraseRegion,
  thresholdPaintedOverlay,
} from '../../../../shared/erase'

export const EMPTY_ERASE_MASK_MESSAGE = zhErrors.client.eraseEmptyMask
export const EMPTY_REPAINT_MASK_MESSAGE = zhErrors.client.repaintEmptyMask
/** 排除误触的一两个像素，要求至少有一小段笔划。 */
export const MIN_MASK_PIXELS = 32

/** 涂抹层只要有半透明像素就算已画；智能选区贴图和红笔共用这条规则。 */
export function overlayDataHasPaint(rgba: Uint8Array | Uint8ClampedArray, minPixels = MIN_MASK_PIXELS) {
  let count = 0
  for (let index = 3; index < rgba.length; index += 4) {
    if (rgba[index] > 0) {
      count += 1
      if (count >= minPixels) return true
    }
  }
  return false
}

export function overlayHasPaint(canvas: HTMLCanvasElement | null, minPixels = MIN_MASK_PIXELS) {
  if (!canvas) return false
  const context = canvas.getContext('2d')
  if (!context) return false
  return overlayDataHasPaint(context.getImageData(0, 0, canvas.width, canvas.height).data, minPixels)
}

export function emptyMaskMessage(mode?: 'remove' | 'repaint') {
  return mode === 'repaint'
    ? i18n.t('errors:client.repaintEmptyMask')
    : i18n.t('errors:client.eraseEmptyMask')
}

export function remapMaskExportError(error: unknown, mode?: 'remove' | 'repaint') {
  if (
    error instanceof Error
    && (error.message === EMPTY_ERASE_MASK_MESSAGE || error.message === i18n.t('errors:client.eraseEmptyMask'))
  ) {
    return new Error(emptyMaskMessage(mode))
  }
  return error instanceof Error ? error : new Error(i18n.t('workstation:errors.maskExportFailed'))
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
    throw new Error(i18n.t('workstation:errors.canvasMaskUnsupported'))
  }

  const sourcePixels = sourceContext.getImageData(0, 0, width, height)
  const overlay = thresholdPaintedOverlay(sourcePixels.data, width, height)
  if (!maskHasEraseRegion(overlay, undefined, MIN_MASK_PIXELS)) throw new Error(emptyMaskMessage('remove'))
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
  if (!sourceContext) throw new Error(i18n.t('workstation:errors.canvasMaskUnsupported'))
  if (imageNaturalSize.width < 1 || imageNaturalSize.height < 1) throw new Error(i18n.t('workstation:errors.sourceSizeUnreadable'))
  const sourcePixels = sourceContext.getImageData(0, 0, width, height)
  const overlay = thresholdPaintedOverlay(sourcePixels.data, width, height)
  if (!maskHasEraseRegion(overlay, undefined, MIN_MASK_PIXELS)) throw new Error(emptyMaskMessage('remove'))
  const mapped = mapOverlayMaskToImage(overlay, width, height, imageNaturalSize.width, imageNaturalSize.height)
  if (!maskHasEraseRegion(mapped, undefined, MIN_MASK_PIXELS)) throw new Error(emptyMaskMessage('remove'))
  const outputCanvas = document.createElement('canvas')
  outputCanvas.width = imageNaturalSize.width
  outputCanvas.height = imageNaturalSize.height
  const outputContext = outputCanvas.getContext('2d')
  if (!outputContext) throw new Error(i18n.t('workstation:errors.canvasMaskUnsupported'))
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
    throw new Error(i18n.t('workstation:errors.canvasMaskUnsupported'))
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
