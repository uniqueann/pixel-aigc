import { clampFocus, sameAspect } from './geometry'
import type { AspectRatioSettings, BatchImage, CropFocus, SubjectBox, SubjectDetection } from './types'

export const MOCK_SUBJECT_BOX: SubjectBox = { x: 0.2, y: 0.05, width: 0.6, height: 0.45 }
export const SUBJECT_CROP_NOTE = '已按主体裁剪'

export function gridFocusLabel(fx: number, fy: number) {
  const x = fx <= 0.25 ? '左' : fx >= 0.75 ? '右' : '中'
  const y = fy <= 0.25 ? '上' : fy >= 0.75 ? '下' : '中'
  if (x === '中' && y === '中') return '正中'
  if (y === '中') return `${x}中`
  if (x === '中') return `${y}中`
  return `${x}${y}`
}

export function gridCropNote(fx: number, fy: number, failed = false) {
  const reason = failed ? '主体检测失败' : '没识别到商品'
  return `${reason}，已按九宫格「${gridFocusLabel(fx, fy)}」裁剪。请把焦点改到商品所在位置后再处理。`
}

export const GRID_CROP_NOTE = gridCropNote(0.5, 0.5)
export const DETECT_FAILED_NOTE = gridCropNote(0.5, 0.5, true)

export function focusFromSubjectBox(
  box: SubjectBox | null,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
) {
  if (!box) return null
  const values = [box.x, box.y, box.width, box.height]
  if (values.some(value => !Number.isFinite(value) || value < 0 || value > 1)) return null
  if (box.width <= 0 || box.height <= 0) return null
  const centerX = (box.x + box.width / 2) * sourceWidth
  const centerY = (box.y + box.height / 2) * sourceHeight
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight)
  const windowWidth = targetWidth / scale
  const windowHeight = targetHeight / scale
  const overflowX = Math.max(0, sourceWidth - windowWidth)
  const overflowY = Math.max(0, sourceHeight - windowHeight)
  return {
    fx: overflowX === 0 ? 0.5 : clampFocus((centerX - windowWidth / 2) / overflowX),
    fy: overflowY === 0 ? 0.5 : clampFocus((centerY - windowHeight / 2) / overflowY),
  }
}

export function mockDetectSubject(miss = false): SubjectDetection {
  return { box: miss ? null : MOCK_SUBJECT_BOX }
}

export function detectSubject(_image: Pick<BatchImage, 'width' | 'height'>, miss = false): Promise<SubjectDetection> {
  return Promise.resolve(mockDetectSubject(miss))
}

export async function cropFocusForImage(
  image: Pick<BatchImage, 'file' | 'width' | 'height'>,
  settings: Pick<AspectRatioSettings, 'strategy' | 'fx' | 'fy'>,
  targetWidth: number,
  targetHeight: number,
  detect: (image: Pick<BatchImage, 'file' | 'width' | 'height'>) => Promise<SubjectDetection> = image => detectSubject(image),
): Promise<CropFocus | undefined> {
  if (settings.strategy !== 'crop' || sameAspect(image.width, image.height, targetWidth, targetHeight)) return undefined
  const grid = { fx: settings.fx, fy: settings.fy, source: 'grid' as const }
  try {
    const detection = await detect(image)
    const focus = focusFromSubjectBox(detection.box, image.width, image.height, targetWidth, targetHeight)
    if (!focus) return { ...grid, note: gridCropNote(settings.fx, settings.fy) }
    return { ...focus, source: 'subject', note: SUBJECT_CROP_NOTE }
  } catch {
    return { ...grid, note: gridCropNote(settings.fx, settings.fy, true) }
  }
}
