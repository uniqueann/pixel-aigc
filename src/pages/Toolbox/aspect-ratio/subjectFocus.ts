import { clampFocus, sameAspect } from './geometry'
import type { AspectRatioSettings, BatchImage, CropFocus, SubjectBox, SubjectDetection } from './types'

export const MOCK_SUBJECT_BOX: SubjectBox = { x: 0.2, y: 0.05, width: 0.6, height: 0.45 }
export const SUBJECT_CROP_NOTE = '已按主体裁剪'
export const GRID_CROP_NOTE = '未找到主体，已按九宫格裁剪'
export const DETECT_FAILED_NOTE = '主体检测失败，已按九宫格裁剪'

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
  image: Pick<BatchImage, 'width' | 'height'>,
  settings: Pick<AspectRatioSettings, 'strategy' | 'fx' | 'fy'>,
  targetWidth: number,
  targetHeight: number,
  detect: (image: Pick<BatchImage, 'width' | 'height'>) => Promise<SubjectDetection> = image => detectSubject(image),
): Promise<CropFocus | undefined> {
  if (settings.strategy !== 'crop' || sameAspect(image.width, image.height, targetWidth, targetHeight)) return undefined
  const grid = { fx: settings.fx, fy: settings.fy, source: 'grid' as const }
  try {
    const detection = await detect(image)
    const focus = focusFromSubjectBox(detection.box, image.width, image.height, targetWidth, targetHeight)
    if (!focus) return { ...grid, note: GRID_CROP_NOTE }
    return { ...focus, source: 'subject', note: SUBJECT_CROP_NOTE }
  } catch {
    return { ...grid, note: DETECT_FAILED_NOTE }
  }
}
