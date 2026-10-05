/** 横向溢出时左右渐隐；贴边或一行放得下时对应一侧消失。 */
export function worksStripFades(metrics: { scrollLeft: number; clientWidth: number; scrollWidth: number }) {
  const overflow = metrics.scrollWidth - metrics.clientWidth
  if (overflow <= 2) return { left: false, right: false }
  return { left: metrics.scrollLeft > 2, right: overflow - metrics.scrollLeft > 2 }
}
