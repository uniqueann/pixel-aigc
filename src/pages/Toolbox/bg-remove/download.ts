import { createResultZip, downloadBlob } from '../shared/zip'
import type { BatchImage } from './types'

export { downloadBlob }

export function outputNames(files: { name: string; mimeType: string }[]) {
  const used = new Set<string>()
  return files.map(({ name, mimeType }) => {
    const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg'
    const base = (name.replace(/\.[^.]+$/, '').replace(/[\\/]/g, '_').split('').map(char => char.charCodeAt(0) < 32 ? '_' : char).join('').trim() || '图片') + '_cutout'
    let candidate = `${base}.${extension}`
    let index = 2
    while (used.has(candidate.toLowerCase())) candidate = `${base}_${index++}.${extension}`
    used.add(candidate.toLowerCase())
    return candidate
  })
}

export function namesForImages(images: BatchImage[]) {
  const names = outputNames(images.map(image => ({
    name: image.file.name,
    mimeType: image.outputMime ?? 'image/png',
  })))
  return new Map(images.map((image, index) => [image.id, names[index]]))
}

export async function createBgRemoveZip(images: BatchImage[]) {
  const complete = images.filter(image => image.status === 'succeeded' && image.output)
  const names = namesForImages(complete)
  return createResultZip(complete.map(image => ({ name: names.get(image.id)!, blob: image.output! })))
}
