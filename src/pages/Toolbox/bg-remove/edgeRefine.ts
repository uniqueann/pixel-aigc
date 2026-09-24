export interface RefineMarks {
  remove: Uint8Array
  restore: Uint8Array
}

export interface ContainRect {
  x: number
  y: number
  width: number
  height: number
}

export function canRefineEdge(item: { matte?: Blob; status: string }) {
  return Boolean(item.matte) && item.status === 'succeeded'
}

export function containRect(canvasWidth: number, canvasHeight: number, imageWidth: number, imageHeight: number): ContainRect {
  const scale = Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight)
  const width = imageWidth * scale
  const height = imageHeight * scale
  return { x: (canvasWidth - width) / 2, y: (canvasHeight - height) / 2, width, height }
}

export function isRestoreMark(red: number, green: number, blue: number, alpha: number) {
  return alpha > 30 && blue > red && blue > green
}

export function sampleRefineMarks(
  canvas: Uint8ClampedArray,
  canvasWidth: number,
  canvasHeight: number,
  imageWidth: number,
  imageHeight: number,
): RefineMarks {
  const remove = new Uint8Array(imageWidth * imageHeight)
  const restore = new Uint8Array(imageWidth * imageHeight)
  const rect = containRect(canvasWidth, canvasHeight, imageWidth, imageHeight)
  for (let y = 0; y < imageHeight; y += 1) {
    for (let x = 0; x < imageWidth; x += 1) {
      const canvasX = Math.min(canvasWidth - 1, Math.max(0, Math.floor(rect.x + (x + 0.5) * rect.width / imageWidth)))
      const canvasY = Math.min(canvasHeight - 1, Math.max(0, Math.floor(rect.y + (y + 0.5) * rect.height / imageHeight)))
      const index = (canvasY * canvasWidth + canvasX) * 4
      const offset = y * imageWidth + x
      const alpha = canvas[index + 3]
      if (isRestoreMark(canvas[index], canvas[index + 1], canvas[index + 2], alpha)) restore[offset] = 1
      else if (alpha > 30) remove[offset] = 1
    }
  }
  return { remove, restore }
}

export function applyEdgeRefinePixels(
  source: Uint8ClampedArray,
  matte: Uint8ClampedArray,
  remove: Uint8Array,
  restore: Uint8Array,
) {
  if (source.length !== matte.length || remove.length * 4 !== matte.length || restore.length !== remove.length) {
    throw new Error('精修结果尺寸与原图不一致')
  }
  const output = new Uint8ClampedArray(matte)
  for (let pixel = 0; pixel < remove.length; pixel += 1) {
    const index = pixel * 4
    if (restore[pixel]) {
      output[index] = source[index]
      output[index + 1] = source[index + 1]
      output[index + 2] = source[index + 2]
      output[index + 3] = 255
    } else if (remove[pixel]) {
      output[index + 3] = 0
    }
  }
  return output
}

async function readPixels(blob: Blob) {
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法读取精修图片')
    context.drawImage(bitmap, 0, 0)
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height)
    return { width: bitmap.width, height: bitmap.height, data: pixels.data }
  } finally {
    bitmap.close()
  }
}

function encodePng(width: number, height: number, pixels: Uint8ClampedArray) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法导出精修结果')
  const image = context.createImageData(width, height)
  image.data.set(pixels)
  context.putImageData(image, 0, 0)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('精修结果编码失败')), 'image/png')
  })
}

export async function renderRefinedMatte(source: Blob, matte: Blob, marks: ImageData) {
  const [sourcePixels, mattePixels] = await Promise.all([readPixels(source), readPixels(matte)])
  if (sourcePixels.width !== mattePixels.width || sourcePixels.height !== mattePixels.height) {
    throw new Error('精修结果尺寸与原图不一致')
  }
  const sampled = sampleRefineMarks(marks.data, marks.width, marks.height, sourcePixels.width, sourcePixels.height)
  const pixels = applyEdgeRefinePixels(sourcePixels.data, mattePixels.data, sampled.remove, sampled.restore)
  const blob = await encodePng(sourcePixels.width, sourcePixels.height, pixels)
  return blob
}
