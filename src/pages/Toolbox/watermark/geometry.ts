import type { WatermarkAnchor } from './types'

export function watermarkPosition(
  imageWidth: number,
  imageHeight: number,
  markWidth: number,
  markHeight: number,
  margin: number,
  anchor: WatermarkAnchor,
) {
  const [vertical, horizontal] = anchor.split('-')
  const left = horizontal === 'left' ? margin : horizontal === 'right' ? imageWidth - margin - markWidth : (imageWidth - markWidth) / 2
  const top = vertical === 'top' ? margin : vertical === 'bottom' ? imageHeight - margin - markHeight : (imageHeight - markHeight) / 2
  return {
    left: Math.max(0, Math.min(imageWidth - markWidth, left)),
    top: Math.max(0, Math.min(imageHeight - markHeight, top)),
  }
}

export function outputNames(files: { name: string; mimeType: string }[]) {
  const used = new Set<string>()
  return files.map(({ name, mimeType }) => {
    const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png'
    const base = (name.replace(/\.[^.]+$/, '').replace(/[\\/]/g, '_').split('').map(char => char.charCodeAt(0) < 32 ? '_' : char).join('').trim() || '图片') + '_watermarked'
    let candidate = `${base}.${extension}`
    let index = 2
    while (used.has(candidate.toLowerCase())) candidate = `${base}_${index++}.${extension}`
    used.add(candidate.toLowerCase())
    return candidate
  })
}
