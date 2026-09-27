import { ERASE_OVERLAY_HEIGHT, ERASE_OVERLAY_WIDTH } from '../../../../shared/erase'

/** 涂抹/扩图逻辑画布。显示宽度跟着容器走，坐标空间仍是这一组像素。 */
export const WORKSTATION_CANVAS_WIDTH = ERASE_OVERLAY_WIDTH
export const WORKSTATION_CANVAS_HEIGHT = ERASE_OVERLAY_HEIGHT

export interface CanvasDisplaySize {
  width: number
  height: number
  scale: number
}

/** 把 640×420 逻辑画布按容器宽度等比缩小，桌面够宽时保持原尺寸。 */
export function workstationCanvasDisplaySize(
  containerWidth: number,
  logicalWidth = WORKSTATION_CANVAS_WIDTH,
  logicalHeight = WORKSTATION_CANVAS_HEIGHT,
): CanvasDisplaySize {
  if (!Number.isFinite(containerWidth) || containerWidth < 1 || logicalWidth < 1 || logicalHeight < 1) {
    return { width: Math.max(1, logicalWidth), height: Math.max(1, logicalHeight), scale: 1 }
  }
  const width = Math.min(logicalWidth, Math.max(1, Math.floor(containerWidth)))
  const scale = width / logicalWidth
  return {
    width,
    height: Math.max(1, Math.round(logicalHeight * scale)),
    scale,
  }
}
