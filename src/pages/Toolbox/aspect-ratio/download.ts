import { normalizeImageBlob } from '@shared/image-format'
import { createResultZip, downloadBlob } from '../shared/zip'
import { outputNames } from './geometry'
import type { BatchImage } from './types'

export { downloadBlob }

export async function normalizedDownloadImages(images: BatchImage[]) {
  return Promise.all(images.map(async image => {
    if (!image.output) return image
    const output = await normalizeImageBlob(image.output)
    return { ...image, output, outputMime: output.type }
  }))
}

export function namesForImages(images: BatchImage[], presetId: string) {
  const names = outputNames(images.map(image => ({
    name: image.file.name,
    mimeType: image.output?.type || image.outputMime || 'image/jpeg',
    presetId,
  })))
  return new Map(images.map((image, index) => [image.id, names[index]]))
}

export async function createAspectRatioZip(images: BatchImage[], presetId: string) {
  const complete = await normalizedDownloadImages(images.filter(image => image.status === 'succeeded' && image.output))
  const names = namesForImages(complete, presetId)
  return createResultZip(complete.map(image => ({ name: names.get(image.id)!, blob: image.output! })))
}
