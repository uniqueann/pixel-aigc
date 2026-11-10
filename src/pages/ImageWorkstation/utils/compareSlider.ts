/** 分割线位置的统一换算：宽度无效时返回 undefined，避免除零。 */
export function comparePositionFromClientX(
  clientX: number,
  rect: { left: number; width: number },
) {
  if (!Number.isFinite(rect.width) || rect.width <= 0) return undefined
  const position = (clientX - rect.left) / rect.width * 100
  if (!Number.isFinite(position)) return undefined
  return Math.min(100, Math.max(0, position))
}

/** 只有宽高比接近时才做同屏分割，避免两侧内容错位或拉伸。 */
export function compareAspectCompatible(
  before?: { width: number; height: number },
  after?: { width: number; height: number },
  tolerance = 0.02,
) {
  if (!before || !after || before.width <= 0 || before.height <= 0 || after.width <= 0 || after.height <= 0) return true
  const beforeRatio = before.width / before.height
  const afterRatio = after.width / after.height
  return Math.abs(beforeRatio - afterRatio) / Math.max(beforeRatio, afterRatio) <= tolerance
}
