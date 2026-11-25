import { normalizeImageBlob } from '@shared/image-format'
import { i18n } from '@/i18n'

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
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error(i18n.t('workstation:errors.resultDecodeFailed'))) }
      image.src = url
    })
  }
  if (!size.width || !size.height) throw new Error(i18n.t('workstation:errors.resultSizeInvalid'))
  return { blob: normalized, mimeType: normalized.type, ...size }
}
