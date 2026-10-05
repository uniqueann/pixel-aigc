/** 贴边容差。作品条左内边距是 3px，加上 scroll-snap 后，未滚动时 scrollLeft 会停在约 3 而不是 0。大于这块内边距才算离开贴边。 */
const EDGE_EPSILON = 8

/** 横向溢出时左右渐隐；贴边或一行放得下时对应一侧消失。 */
export function worksStripFades(metrics: { scrollLeft: number; clientWidth: number; scrollWidth: number }) {
  const scrollLeft = Number.isFinite(metrics.scrollLeft) ? Math.max(0, metrics.scrollLeft) : 0
  const clientWidth = Number.isFinite(metrics.clientWidth) ? metrics.clientWidth : 0
  const scrollWidth = Number.isFinite(metrics.scrollWidth) ? metrics.scrollWidth : 0
  const overflow = scrollWidth - clientWidth
  if (overflow <= EDGE_EPSILON) return { left: false, right: false }
  return { left: scrollLeft > EDGE_EPSILON, right: overflow - scrollLeft > EDGE_EPSILON }
}
