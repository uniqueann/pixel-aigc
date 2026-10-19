/**
 * 解析并计算长宽比数值（宽/高）
 */
export function resolveAspectRatio(ratio?: string, width?: number, height?: number): number {
  if (typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0) {
    return width / height
  }
  if (typeof ratio === 'string') {
    const parts = ratio.split(':').map(Number)
    if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]) && parts[0] > 0 && parts[1] > 0) {
      return parts[0] / parts[1]
    }
  }
  return 1
}

/**
 * 计算在指定盒子尺寸内，既保持视觉面积均衡、又精确展示横纵比的矩形几何参数
 */
export function computeAspectRect(ratioValue: number, box = 18) {
  const r = Number.isFinite(ratioValue) && ratioValue > 0 ? ratioValue : 1
  let w: number
  let h: number

  if (Math.abs(r - 1) < 0.05) {
    // 正方形 1:1，设定合适视觉重量
    w = 11.5
    h = 11.5
  } else if (r > 1) {
    // 横屏：宽度范围在 12 ~ 15，高度依比例衰减但保持下限 >= 7
    w = Math.min(15, Math.max(12, Math.round(Math.sqrt(120 * r) * 2) / 2))
    h = Math.max(7, Math.round((w / r) * 2) / 2)
  } else {
    // 竖屏：高度范围在 12 ~ 15，宽度依比例衰减但保持下限 >= 7
    h = Math.min(15, Math.max(12, Math.round(Math.sqrt(120 / r) * 2) / 2))
    w = Math.max(7, Math.round((h * r) * 2) / 2)
  }

  const x = Math.round(((box - w) / 2) * 100) / 100
  const y = Math.round(((box - h) / 2) * 100) / 100

  return { w, h, x, y }
}
