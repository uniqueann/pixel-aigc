import { ERASE_OVERLAY_HEIGHT, ERASE_OVERLAY_WIDTH } from '../../../../shared/erase'

/** 涂抹/扩图逻辑画布。显示宽度跟着容器走，坐标空间仍是这一组像素。 */
export const WORKSTATION_CANVAS_WIDTH = ERASE_OVERLAY_WIDTH
export const WORKSTATION_CANVAS_HEIGHT = ERASE_OVERLAY_HEIGHT

export interface CanvasDisplaySize {
  width: number
  height: number
  scale: number
}

/**
 * 把 640×420 逻辑画布等比缩小，桌面够宽时保持原尺寸。
 * 传入容器高度时同时受宽高约束，避免窄屏下画布底部被 shell 裁掉。
 */
export function workstationCanvasDisplaySize(
  containerWidth: number,
  containerHeight?: number,
  logicalWidth = WORKSTATION_CANVAS_WIDTH,
  logicalHeight = WORKSTATION_CANVAS_HEIGHT,
): CanvasDisplaySize {
  if (!Number.isFinite(containerWidth) || containerWidth < 1 || logicalWidth < 1 || logicalHeight < 1) {
    return { width: Math.max(1, logicalWidth), height: Math.max(1, logicalHeight), scale: 1 }
  }
  let width = Math.min(logicalWidth, Math.max(1, Math.floor(containerWidth)))
  if (typeof containerHeight === 'number' && Number.isFinite(containerHeight) && containerHeight > 0) {
    const heightLimitedWidth = Math.floor((containerHeight * logicalWidth) / logicalHeight)
    width = Math.min(width, Math.max(1, heightLimitedWidth))
  }
  const scale = width / logicalWidth
  return {
    width,
    height: Math.max(1, Math.round(logicalHeight * scale)),
    scale,
  }
}
