import type { CSSProperties } from 'react'
import { computeAspectRect, resolveAspectRatio } from './aspectRatioGeometry'

export interface AspectRatioIconProps {
  /** 比例字符串，如 '1:1', '4:3', '3:4', '16:9', '9:16', '3:2' 等 */
  ratio?: string
  /** 宽度像素或比例基准（可选，与 height 配合计算比例） */
  width?: number
  /** 高度像素或比例基准（可选，与 width 配合计算比例） */
  height?: number
  /** 图标容器尺寸（宽高正方形），默认 18 */
  size?: number
  /** 线框圆角半径，默认 1.5 */
  radius?: number
  /** 线框线条粗细，默认 1.25 */
  strokeWidth?: number
  className?: string
  style?: CSSProperties
}

export default function AspectRatioIcon({
  ratio,
  width,
  height,
  size = 18,
  radius = 1.5,
  strokeWidth = 1.25,
  className = '',
  style,
}: AspectRatioIconProps) {
  const numericRatio = resolveAspectRatio(ratio, width, height)
  const { w, h, x, y } = computeAspectRect(numericRatio, size)

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`aspect-ratio-icon ${className}`.trim()}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={radius}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        fill="currentColor"
        fillOpacity={0.08}
      />
    </svg>
  )
}
