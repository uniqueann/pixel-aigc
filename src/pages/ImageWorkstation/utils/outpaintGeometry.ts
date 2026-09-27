import { expansionPlan } from '@/pages/Toolbox/aspect-ratio/expansion'

export const OUTPAINT_VIEW_WIDTH = 640
export const OUTPAINT_VIEW_HEIGHT = 420
export const OUTPAINT_VIEW_PADDING = 48

export interface OutpaintModelGeometry {
  targetSize: { width: number; height: number }
  originOffset: { x: number; y: number }
  sourceSize: { width: number; height: number }
}

/** 平台预设：contain 进精确 preset 像素，与工具箱转比例同一套 expansionPlan。 */
export function presetOutpaintGeometry(
  sourceWidth: number,
  sourceHeight: number,
  presetWidth: number,
  presetHeight: number,
): OutpaintModelGeometry {
  const plan = expansionPlan(sourceWidth, sourceHeight, presetWidth, presetHeight)
  return {
    targetSize: { width: presetWidth, height: presetHeight },
    originOffset: plan.originOffset,
    sourceSize: plan.sourceSize,
  }
}

/** 自由拖拽：目标不小于原图，原图居中；尺寸来自整数模型，不读描边。 */
export function freeOutpaintGeometry(
  sourceWidth: number,
  sourceHeight: number,
  frameWidth: number,
  frameHeight: number,
): OutpaintModelGeometry {
  const width = Math.max(sourceWidth, Math.max(1, Math.round(frameWidth)))
  const height = Math.max(sourceHeight, Math.max(1, Math.round(frameHeight)))
  return {
    targetSize: { width, height },
    originOffset: {
      x: Math.max(0, Math.round((width - sourceWidth) / 2)),
      y: Math.max(0, Math.round((height - sourceHeight) / 2)),
    },
    sourceSize: { width: sourceWidth, height: sourceHeight },
  }
}

export function outpaintDisplayScale(targetWidth: number, targetHeight: number) {
  return Math.min(
    (OUTPAINT_VIEW_WIDTH - OUTPAINT_VIEW_PADDING * 2) / targetWidth,
    (OUTPAINT_VIEW_HEIGHT - OUTPAINT_VIEW_PADDING * 2) / targetHeight,
  )
}

/** 把画布上的框换算成整数像素。用对象宽高×缩放，不用包含描边的 bounding box。 */
export function modelSizeFromDisplay(displayWidth: number, displayHeight: number, displayScale: number) {
  if (displayScale <= 0) return { width: 1, height: 1 }
  return {
    width: Math.max(1, Math.round(displayWidth / displayScale)),
    height: Math.max(1, Math.round(displayHeight / displayScale)),
  }
}
