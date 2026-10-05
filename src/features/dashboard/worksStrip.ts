/** 贴边容差。scrollLeft≈0 或距右端不足该像素时，对应一侧不渐隐。 */
const EDGE_EPSILON = 2

/** 横向溢出时左右渐隐；贴边或一行放得下时对应一侧消失。 */
export function worksStripFades(metrics: { scrollLeft: number; clientWidth: number; scrollWidth: number }) {
  const scrollLeft = Number.isFinite(metrics.scrollLeft) ? Math.max(0, metrics.scrollLeft) : 0
  const clientWidth = Number.isFinite(metrics.clientWidth) ? metrics.clientWidth : 0
  const scrollWidth = Number.isFinite(metrics.scrollWidth) ? metrics.scrollWidth : 0
  const overflow = scrollWidth - clientWidth
  if (overflow <= EDGE_EPSILON) return { left: false, right: false }
  return { left: scrollLeft > EDGE_EPSILON, right: overflow - scrollLeft > EDGE_EPSILON }
}
