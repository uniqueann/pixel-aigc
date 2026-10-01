import { normalizeImageBlob } from '@shared/image-format'

export async function readResultImage(blob: Blob) {
  const normalized = await normalizeImageBlob(blob)
  let size: { width: number; height: number }
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(normalized, { imageOrientation: 'from-image' })
    size = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
  } else {
    size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const url = URL.createObjectURL(normalized)
      const image = new Image()
      image.onload = () => { URL.revokeObjectURL(url); resolve({ width: image.naturalWidth, height: image.naturalHeight }) }
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('生成结果无法解码')) }
      image.src = url
    })
  }
  if (!size.width || !size.height) throw new Error('生成结果尺寸无效')
  return { blob: normalized, mimeType: normalized.type, ...size }
}
