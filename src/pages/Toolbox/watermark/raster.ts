/** JPEG 质量。PNG 编码会忽略该值；两条路径必须使用同一个数。 */
export const WATERMARK_OUTPUT_QUALITY = 0.92

export function canvasSizeForSource(sourceWidth: number, sourceHeight: number, previewMaxDimension?: number) {
  const scale = previewMaxDimension
    ? Math.min(1, previewMaxDimension / Math.max(sourceWidth, sourceHeight))
    : 1
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  }
}
