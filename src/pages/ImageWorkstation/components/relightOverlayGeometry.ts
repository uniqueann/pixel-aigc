import type { RelightDirection } from '@shared/relight'

export interface OverlayPoint {
  x: number
  y: number
}

export type RelightOverlayKind = 'planar' | 'front' | 'back'

export interface RelightOverlayGeometry {
  kind: RelightOverlayKind
  /** 平面光的主光箭头；正面/逆光不画箭头，改用徽标表达光源位置。 */
  lightStart?: OverlayPoint
  lightEnd?: OverlayPoint
  /** 正面光的镜头徽标位置：光源在镜头方向。 */
  camera?: OverlayPoint
  /** 逆光的背后辉光位置：光源在商品背后。 */
  glow?: OverlayPoint
  shadowStart: OverlayPoint
  shadowEnd: OverlayPoint
  shadowAngle: number
  handle: OverlayPoint
  rimRadius?: number
}

const PLANAR_UNITS: Record<Exclude<RelightDirection, 'front' | 'back'>, OverlayPoint> = {
  top: { x: 0, y: -1 },
  'top-right': { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
  right: { x: 1, y: 0 },
  'bottom-right': { x: Math.SQRT1_2, y: Math.SQRT1_2 },
  bottom: { x: 0, y: 1 },
  'bottom-left': { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
  left: { x: -1, y: 0 },
  'top-left': { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
}

/**
 * 预览叠加的几何只表达两件事：光源在哪、投影往哪落。
 * 平面光用实线箭头；正面光用镜头徽标；逆光用背后辉光 + 轮廓光。
 * 这样「正面」不会退化成「底部」，「逆光」也不会和虚线投影共用同一种线型。
 */
export function relightOverlayGeometry(
  direction: RelightDirection,
  width: number,
  height: number,
): RelightOverlayGeometry {
  const min = Math.min(width, height)
  const center = { x: width / 2, y: height / 2 }
  const outer = Math.max(0, min / 2 - 30)
  const inner = Math.max(18, min * 0.17)

  if (direction === 'front') {
    const camera = { x: center.x, y: center.y + outer }
    return {
      kind: 'front',
      camera,
      shadowStart: { x: center.x, y: center.y - inner },
      shadowEnd: { x: center.x, y: center.y - outer },
      shadowAngle: -90,
      handle: camera,
    }
  }

  if (direction === 'back') {
    const glow = { x: center.x, y: center.y - outer }
    return {
      kind: 'back',
      glow,
      shadowStart: { x: center.x, y: center.y + inner },
      shadowEnd: { x: center.x, y: center.y + outer },
      shadowAngle: 90,
      handle: glow,
      rimRadius: Math.max(24, inner * 0.95),
    }
  }

  const unit = PLANAR_UNITS[direction]
  const lightStart = { x: center.x + unit.x * outer, y: center.y + unit.y * outer }
  const lightEnd = { x: center.x + unit.x * inner, y: center.y + unit.y * inner }
  const shadowStart = { x: center.x - unit.x * inner, y: center.y - unit.y * inner }
  const shadowEnd = { x: center.x - unit.x * outer, y: center.y - unit.y * outer }

  return {
    kind: 'planar',
    lightStart,
    lightEnd,
    shadowStart,
    shadowEnd,
    shadowAngle: Math.atan2(shadowEnd.y - shadowStart.y, shadowEnd.x - shadowStart.x) * 180 / Math.PI,
    handle: lightStart,
  }
}
