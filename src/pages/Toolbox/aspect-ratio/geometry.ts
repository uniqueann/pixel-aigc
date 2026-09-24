export interface ContainRect {
  x: number
  y: number
  width: number
  height: number
  scale: number
}

export interface CoverCrop {
  sx: number
  sy: number
  sw: number
  sh: number
  scale: number
}

export function clampFocus(value: number) {
  if (!Number.isFinite(value)) return 0.5
  return Math.min(1, Math.max(0, value))
}

export function sameAspect(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number) {
  return Math.abs(sourceWidth * targetHeight - sourceHeight * targetWidth) <= 1
}

export function containRect(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number): ContainRect {
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight)
  const width = Math.min(targetWidth, Math.max(1, Math.round(sourceWidth * scale)))
  const height = Math.min(targetHeight, Math.max(1, Math.round(sourceHeight * scale)))
  return {
    x: Math.floor((targetWidth - width) / 2),
    y: Math.floor((targetHeight - height) / 2),
    width,
    height,
    scale,
  }
}

export function coverCrop(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  fx: number,
  fy: number,
): CoverCrop {
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight)
  const sw = targetWidth / scale
  const sh = targetHeight / scale
  const overflowX = Math.max(0, sourceWidth - sw)
  const overflowY = Math.max(0, sourceHeight - sh)
  return {
    sx: clampFocus(fx) * overflowX,
    sy: clampFocus(fy) * overflowY,
    sw,
    sh,
    scale,
  }
}

export function fitScale(
  strategy: 'letterbox' | 'crop',
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
) {
  const ratio = strategy === 'crop'
    ? Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight)
    : Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight)
  return ratio
}

export function outputSize(targetWidth: number, targetHeight: number, previewMaxDimension?: number) {
  if (!previewMaxDimension) return { width: targetWidth, height: targetHeight, scale: 1 }
  const scale = Math.min(1, previewMaxDimension / Math.max(targetWidth, targetHeight))
  return {
    width: Math.max(1, Math.round(targetWidth * scale)),
    height: Math.max(1, Math.round(targetHeight * scale)),
    scale,
  }
}

export function outputMime(strategy: 'letterbox' | 'crop' | 'outpaint', background: string) {
  return strategy === 'letterbox' && background === 'transparent' ? 'image/png' : 'image/jpeg'
}

export function outputNames(files: { name: string; mimeType: string; presetId: string }[]) {
  const used = new Set<string>()
  return files.map(({ name, mimeType, presetId }) => {
    const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg'
    const base = (name.replace(/\.[^.]+$/, '').replace(/[\\/]/g, '_').split('').map(char => char.charCodeAt(0) < 32 ? '_' : char).join('').trim() || '图片') + `_${presetId}`
    let candidate = `${base}.${extension}`
    let index = 2
    while (used.has(candidate.toLowerCase())) candidate = `${base}_${index++}.${extension}`
    used.add(candidate.toLowerCase())
    return candidate
  })
}
