import type { RelightDirection } from '@shared/relight'

const CLOCKWISE: RelightDirection[] = [
  'top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left', 'top-left',
]

/** 把相对中心的指针位置吸附到 8 个平面方向；靠近中心回到正面。 */
export function directionFromPoint(dx: number, dy: number, minSize: number): RelightDirection {
  if (Math.hypot(dx, dy) < minSize * 0.14) return 'front'
  const index = Math.round(Math.atan2(dx, -dy) / (Math.PI / 4))
  return CLOCKWISE[((index % 8) + 8) % 8]
}
