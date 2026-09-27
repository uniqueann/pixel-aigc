/** 蒙版画布的固定舞台。原图用 contain 放在里面，涂抹坐标要映射回原图像素。 */
export const MASK_STAGE_WIDTH = 640
export const MASK_STAGE_HEIGHT = 420

export function containStage(
  stageWidth: number,
  stageHeight: number,
  imageWidth: number,
  imageHeight: number,
) {
  const scale = Math.min(stageWidth / imageWidth, stageHeight / imageHeight)
  const width = imageWidth * scale
  const height = imageHeight * scale
  return {
    scale,
    offsetX: (stageWidth - width) / 2,
    offsetY: (stageHeight - height) / 2,
    width,
    height,
  }
}

/**
 * 把舞台上的涂抹（0–255，一行一个像素）映射成原图尺寸的纯黑白蒙版。
 * 只采样落在画面矩形内的笔迹。没有任何白像素时返回 null。
 */
export function mapDisplayMask(
  painted: ArrayLike<number>,
  stageWidth: number,
  stageHeight: number,
  imageWidth: number,
  imageHeight: number,
): Uint8Array | null {
  if (stageWidth < 1 || stageHeight < 1 || imageWidth < 1 || imageHeight < 1) return null
  if (painted.length < stageWidth * stageHeight) return null
  const frame = containStage(stageWidth, stageHeight, imageWidth, imageHeight)
  const mask = new Uint8Array(imageWidth * imageHeight)
  let paintedPixels = 0
  for (let y = 0; y < imageHeight; y += 1) {
    const sourceY = Math.floor(frame.offsetY + (y + 0.5) * frame.scale)
    for (let x = 0; x < imageWidth; x += 1) {
      const sourceX = Math.floor(frame.offsetX + (x + 0.5) * frame.scale)
      const on = sourceX >= 0 && sourceY >= 0 && sourceX < stageWidth && sourceY < stageHeight
        && painted[sourceY * stageWidth + sourceX] >= 128
      if (!on) continue
      mask[y * imageWidth + x] = 255
      paintedPixels += 1
    }
  }
  return paintedPixels > 0 ? mask : null
}

/** 把映射后的蒙版画成与原图同尺寸的黑白 PNG。 */
export function maskToPngBlob(mask: Uint8Array, width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return Promise.reject(new Error('当前浏览器不支持蒙版导出'))
  const image = context.createImageData(width, height)
  for (let index = 0; index < mask.length; index += 1) {
    const value = mask[index] >= 128 ? 255 : 0
    const offset = index * 4
    image.data[offset] = value
    image.data[offset + 1] = value
    image.data[offset + 2] = value
    image.data[offset + 3] = 255
  }
  context.putImageData(image, 0, 0)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('蒙版编码失败')), 'image/png')
  })
}

/** 读取画布导出的蒙版，并映射到原图宽高。没有涂抹时返回 null。 */
export async function maskPngFromExport(dataUrl: string, imageWidth: number, imageHeight: number) {
  const image = new Image()
  image.src = dataUrl
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')
  if (!context || !canvas.width || !canvas.height) throw new Error('蒙版画布尚未准备好')
  context.drawImage(image, 0, 0)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
  const painted = new Uint8Array(canvas.width * canvas.height)
  for (let index = 0; index < painted.length; index += 1) painted[index] = pixels.data[index * 4]
  const mapped = mapDisplayMask(painted, canvas.width, canvas.height, imageWidth, imageHeight)
  if (!mapped) return null
  return maskToPngBlob(mapped, imageWidth, imageHeight)
}
