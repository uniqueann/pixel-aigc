import { i18n } from '@/i18n'
import zhToolbox from '@/i18n/locales/zh-CN/toolbox.json'
import { clampFocus, sameAspect } from './geometry'
import type { AspectRatioSettings, BatchImage, CropFocus, SubjectBox, SubjectDetection } from './types'

export const MOCK_SUBJECT_BOX: SubjectBox = { x: 0.2, y: 0.05, width: 0.6, height: 0.45 }
export const SUBJECT_CROP_NOTE = zhToolbox.aspectRatio.crop.subjectNote

export function getSubjectCropNote() {
  return i18n.t('toolbox:aspectRatio.crop.subjectNote')
}

export function gridFocusLabel(fx: number, fy: number) {
  const x = fx <= 0.25 ? 'left' : fx >= 0.75 ? 'right' : 'center'
  const y = fy <= 0.25 ? 'top' : fy >= 0.75 ? 'bottom' : 'middle'
  return i18n.t(`toolbox:anchors.${y}-${x}` as const)
}

export function isCenterFocus(fx: number, fy: number) {
  return fx > 0.25 && fx < 0.75 && fy > 0.25 && fy < 0.75
}

export const CENTER_CROP_UNAVAILABLE_NOTE = zhToolbox.aspectRatio.crop.centerUnavailableNote

export function getCenterCropUnavailableNote() {
  return i18n.t('toolbox:aspectRatio.crop.centerUnavailableNote')
}

export function gridCropNote(fx: number, fy: number, failed = false) {
  if (failed) {
    return isCenterFocus(fx, fy)
      ? getCenterCropUnavailableNote()
      : i18n.t('toolbox:aspectRatio.crop.gridUnavailableNote', { focus: gridFocusLabel(fx, fy) })
  }
  return i18n.t('toolbox:aspectRatio.crop.gridMissedNote', { focus: gridFocusLabel(fx, fy) })
}

export function unavailableCropSummary(focuses: Array<Pick<CropFocus, 'unavailable' | 'fx' | 'fy'> | undefined>) {
  const degraded = focuses.filter((focus): focus is Pick<CropFocus, 'unavailable' | 'fx' | 'fy'> => Boolean(focus?.unavailable))
  if (!degraded.length) return ''
  return degraded.every(focus => isCenterFocus(focus.fx, focus.fy))
    ? i18n.t('toolbox:aspectRatio.crop.summaryCenter', { count: degraded.length })
    : i18n.t('toolbox:aspectRatio.crop.summaryGrid', { count: degraded.length })
}

export const GRID_CROP_NOTE = gridCropNote(0.5, 0.5)
export const DETECT_FAILED_NOTE = gridCropNote(0.5, 0.5, true)
export const DETECT_MAX_EDGE = 1280

export function detectionPixelSize(width: number, height: number, maxEdge = DETECT_MAX_EDGE) {
  const longest = Math.max(width, height)
  if (!Number.isFinite(longest) || longest <= maxEdge) return { width, height }
  const scale = maxEdge / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export function cropProgressLabel(completed: number, total: number, names: string[]) {
  const shown = names.slice(0, 2).join(i18n.t('toolbox:shared.listSeparator'))
  const more = names.length > 2 ? i18n.t('toolbox:aspectRatio.crop.progressMore', { count: names.length }) : ''
  const current = shown ? i18n.t('toolbox:aspectRatio.crop.progressCurrent', { shown, more }) : ''
  return i18n.t('toolbox:aspectRatio.crop.progress', { completed, total, current })
}

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
    return { ...focus, source: 'subject', note: getSubjectCropNote() }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    return { ...grid, unavailable: true, note: gridCropNote(settings.fx, settings.fy, true) }
  }
}
