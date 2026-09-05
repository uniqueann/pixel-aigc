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
  const outputPixels = outputContext.createImageData(width, height)

  for (let index = 0; index < sourcePixels.data.length; index += 4) {
    const isSelected = sourcePixels.data[index + 3] > 0
    const value = isSelected ? 255 : 0
    outputPixels.data[index] = value
    outputPixels.data[index + 1] = value
    outputPixels.data[index + 2] = value
    outputPixels.data[index + 3] = 255
  }

  outputContext.putImageData(outputPixels, 0, 0)
  return { maskDataUrl: outputCanvas.toDataURL('image/png'), width, height }
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
