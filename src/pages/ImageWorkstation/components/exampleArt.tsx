interface Props {
  /** 商品填充色；换颜色示例用主色强调「已改」。 */
  fill?: string
  stroke?: string
  strokeWidth?: number
}

/** 示例卡共用的商品剪影：重新打光与智能编辑用同一形状，保证工作站内的教学语法一致。 */
export function ProductSilhouette({
  fill = 'var(--color-surface-2)',
  stroke = 'var(--color-border-strong)',
  strokeWidth = 1.5,
}: Props) {
  return (
    <>
      <path
        d="M40 40h30v32a7 7 0 0 1-7 7H47a7 7 0 0 1-7-7V40Z"
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      <path
        d="M70 47h5a8 8 0 0 1 0 16h-5"
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
    </>
  )
}
