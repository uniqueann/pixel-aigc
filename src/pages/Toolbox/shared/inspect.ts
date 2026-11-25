import { detectImageMime, equalsAscii } from '@shared/image-format'
import { i18n } from '@/i18n'
import { formatMegabytes } from '@/i18n/format'
import { useUserStore } from '@/store/useUserStore'
import { trackFirstUpload, uploadToolForPath } from '@/features/activation/client'
export const MAX_FILES = 20
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
export const MAX_BATCH_BYTES = 150 * 1024 * 1024
export const MAX_ZIP_BYTES = 200 * 1024 * 1024
export const MAX_DESKTOP_PIXELS = 24_000_000
export const MAX_MOBILE_PIXELS = 12_000_000
export const MAX_LOGO_BYTES = 10 * 1024 * 1024

export function queueLimitMessage(file: File, queuedCount: number, queuedBytes: number) {
  if (file.size > MAX_IMAGE_BYTES) {
    return i18n.t('toolbox:validation.fileTooLarge', { name: file.name, limit: formatMegabytes(MAX_IMAGE_BYTES) })
  }
  if (queuedCount >= MAX_FILES) {
    return i18n.t('toolbox:validation.batchCountLimit', { name: file.name, max: MAX_FILES })
  }
  if (queuedBytes + file.size > MAX_BATCH_BYTES) {
    return i18n.t('toolbox:validation.batchBytesLimit', { name: file.name, limit: formatMegabytes(MAX_BATCH_BYTES) })
  }
  return null
}

export type SupportedMime = 'image/jpeg' | 'image/png' | 'image/webp'

async function isAnimatedPng(file: File) {
  let offset = 8
  while (offset + 12 <= file.size) {
    const header = new DataView(await file.slice(offset, offset + 8).arrayBuffer())
    const length = header.getUint32(0)
    const type = new Uint8Array(header.buffer, 4, 4)
    if (equalsAscii(type, 0, 'acTL')) return true
    if (equalsAscii(type, 0, 'IDAT') || equalsAscii(type, 0, 'IEND')) return false
    const next = offset + 12 + length
    if (next <= offset || next > file.size) throw new Error(i18n.t('toolbox:validation.invalidPngStructure'))
    offset = next
  }
  throw new Error(i18n.t('toolbox:validation.invalidPngStructure'))
}

async function isAnimatedWebp(file: File) {
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer())
  return equalsAscii(head, 12, 'VP8X') && Boolean(head[20] & 0x02)
}

function isMobileDevice() {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
}

function readSizeWithImage(file: File) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(i18n.t('toolbox:errors.decodeFailed')))
    }
    image.src = url
  })
}

export async function inspectImage(file: File) {
  const owner = useUserStore.getState().userId
  const tool = uploadToolForPath()
  if (file.size === 0) throw new Error(i18n.t('toolbox:validation.imageEmpty'))
  if (file.size > MAX_IMAGE_BYTES) throw new Error(i18n.t('errors:generic.singleImageTooLarge'))
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer())
  const mimeType = detectImageMime(head)
  if (!mimeType) throw new Error(i18n.t('toolbox:validation.staticImageOnly'))
  if ((mimeType === 'image/png' && await isAnimatedPng(file)) ||
      (mimeType === 'image/webp' && await isAnimatedWebp(file))) {
    throw new Error(i18n.t('toolbox:validation.animatedImageUnsupported'))
  }
  let size: { width: number; height: number }
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    size = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
  } else {
    size = await readSizeWithImage(file)
  }
  if (!size.width || !size.height) throw new Error(i18n.t('toolbox:validation.imageDimensionsFailed'))
  const limit = isMobileDevice() ? MAX_MOBILE_PIXELS : MAX_DESKTOP_PIXELS
  if (size.width * size.height > limit) {
    throw new Error(i18n.t('toolbox:validation.pixelLimitExceeded', { mp: limit / 1_000_000 }))
  }
  trackFirstUpload(owner, tool)
  return { ...size, mimeType }
}

export async function inspectLogo(file: File) {
  if (file.size === 0 || file.size > MAX_LOGO_BYTES) {
    throw new Error(i18n.t('toolbox:validation.logoTooLarge', { limit: formatMegabytes(MAX_LOGO_BYTES) }))
  }
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer())
  const mimeType = detectImageMime(head)
  if (mimeType !== 'image/png' && mimeType !== 'image/webp') throw new Error(i18n.t('toolbox:validation.logoTypeOnly'))
  if (mimeType === 'image/png' && await isAnimatedPng(file)) throw new Error(i18n.t('toolbox:validation.logoAnimatedUnsupported'))
  if (mimeType === 'image/webp' && await isAnimatedWebp(file)) throw new Error(i18n.t('toolbox:validation.logoAnimatedUnsupported'))
  let pixels: number
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file)
    pixels = bitmap.width * bitmap.height
    bitmap.close()
  } else {
    const size = await readSizeWithImage(file)
    pixels = size.width * size.height
  }
  if (pixels > MAX_DESKTOP_PIXELS) throw new Error(i18n.t('toolbox:validation.logoPixelLimit'))
}
