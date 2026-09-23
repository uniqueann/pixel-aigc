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

export function watermarkTilePositions(
  imageWidth: number,
  imageHeight: number,
  markWidth: number,
  markHeight: number,
  gap: number,
  rotation: number,
) {
  const angle = rotation * Math.PI / 180
  const cos = Math.abs(Math.cos(angle))
  const sin = Math.abs(Math.sin(angle))
  const extentX = (imageWidth * cos + imageHeight * sin + markWidth) / 2
  const extentY = (imageWidth * sin + imageHeight * cos + markHeight) / 2
  let stepX = Math.max(1, markWidth + gap)
  let stepY = Math.max(1, markHeight + gap)
  const count = () => (2 * Math.ceil(extentX / stepX) + 1) * (2 * Math.ceil(extentY / stepY) + 1)
  if (count() > 900) {
    const factor = Math.sqrt(count() / 900)
    stepX *= factor
    stepY *= factor
    while (count() > 900) { stepX *= 1.1; stepY *= 1.1 }
  }
  const columns = Math.ceil(extentX / stepX)
  const rows = Math.ceil(extentY / stepY)
  const positions: { left: number; top: number }[] = []
  for (let row = -rows; row <= rows; row += 1) {
    for (let column = -columns; column <= columns; column += 1) {
      positions.push({
        left: column * stepX + (Math.abs(row) % 2) * stepX / 2 - markWidth / 2,
        top: row * stepY - markHeight / 2,
      })
    }
  }
  return positions
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
