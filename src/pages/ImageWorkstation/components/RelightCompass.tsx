import { useRef, type KeyboardEvent } from 'react'
import { ArrowUpOutlined } from '@ant-design/icons'
import {
  RELIGHT_DIRECTION_HINTS,
  RELIGHT_DIRECTION_LABELS,
  RELIGHT_QUALITY_LABELS,
  RELIGHT_TEMPERATURE_LABELS,
  type RelightDirection,
  type RelightOptions,
} from '@shared/relight'

interface Props {
  value: RelightOptions
  disabled?: boolean
  onChange: (value: RelightOptions) => void
}

interface CompassCell {
  id: RelightDirection
  label: string
  row: number
  col: number
  /** 箭头指向商品中心；顶部为 0°，顺时针。 */
  rotate: number
}

interface RelightPreset {
  label: string
  value: Pick<RelightOptions, 'direction' | 'quality' | 'temperature'>
}

/** 三个常用起点，避免用户在 10×2×3 的组合里从零开始。 */
const PRESETS: RelightPreset[] = [
  { label: '棚拍柔光', value: { direction: 'front', quality: 'soft', temperature: 'neutral' } },
  { label: '日落暖光', value: { direction: 'bottom-left', quality: 'soft', temperature: 'warm' } },
  { label: '冷调轮廓光', value: { direction: 'back', quality: 'hard', temperature: 'cool' } },
]

/** 八个平面方位；中心留给商品图形，正面/逆光由下方深度行表达。 */
const CELLS: CompassCell[] = [
  { id: 'top-left', label: '左上', row: 0, col: 0, rotate: 135 },
  { id: 'top', label: '顶部', row: 0, col: 1, rotate: 180 },
  { id: 'top-right', label: '右上', row: 0, col: 2, rotate: 225 },
  { id: 'left', label: '左侧', row: 1, col: 0, rotate: 90 },
  { id: 'right', label: '右侧', row: 1, col: 2, rotate: 270 },
  { id: 'bottom-left', label: '左下', row: 2, col: 0, rotate: 45 },
  { id: 'bottom', label: '底部', row: 2, col: 1, rotate: 0 },
  { id: 'bottom-right', label: '右下', row: 2, col: 2, rotate: 315 },
]

const DEPTH_OPTIONS = [
  { id: 'front', label: '正面光' },
  { id: 'back', label: '背面 · 逆光' },
] as const

function ProductGlyph() {
  return (
    <svg viewBox="0 0 40 40" width="22" height="22" aria-hidden="true" focusable="false">
      <path d="M14 10h12a3 3 0 0 1 3 3v16a3 3 0 0 1-3 3H14a3 3 0 0 1-3-3V13a3 3 0 0 1 3-3Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M17 10V7.5A1.5 1.5 0 0 1 18.5 6h3A1.5 1.5 0 0 1 23 7.5V10" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 16h8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  )
}

/** 空间化光线方向：商品在中心，八个平面方位环绕，正面/逆光在同一 radiogroup 的深度行。 */
export default function RelightCompass({ value, disabled = false, onChange }: Props) {
  const isBack = value.direction === 'back'
  const cellRefs = useRef(new Map<RelightDirection, HTMLButtonElement>())

  const select = (direction: RelightDirection) => {
    if (disabled) return
    onChange({ ...value, direction })
  }

  const moveFocus = (id: RelightDirection) => {
    requestAnimationFrame(() => cellRefs.current.get(id)?.focus())
  }

  const onCellKeyDown = (event: KeyboardEvent<HTMLButtonElement>, cell: CompassCell) => {
    if (disabled) return
    const delta = event.key === 'ArrowUp' ? { row: -1, col: 0 }
      : event.key === 'ArrowDown' ? { row: 1, col: 0 }
        : event.key === 'ArrowLeft' ? { row: 0, col: -1 }
          : event.key === 'ArrowRight' ? { row: 0, col: 1 }
            : null
    if (!delta) return
    event.preventDefault()
    // 底行向下进入深度行，正面/逆光不再占用网格中心。
    if (event.key === 'ArrowDown' && cell.row === 2) {
      select('front')
      moveFocus('front')
      return
    }
    let row = cell.row + delta.row
    let col = cell.col + delta.col
    if (row < 0 || row > 2 || col < 0 || col > 2) return
    // 中心是商品而非光源：沿同一方向再走一步，落到对侧格子。
    if (row === 1 && col === 1) {
      row += delta.row
      col += delta.col
    }
    if (row < 0 || row > 2 || col < 0 || col > 2) return
    const next = CELLS.find(item => item.row === row && item.col === col)
    if (!next) return
    select(next.id)
    moveFocus(next.id)
  }

  const onDepthKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: 'front' | 'back') => {
    if (disabled) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const next = id === 'front' ? 'back' : 'front'
      select(next)
      moveFocus(next)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      select('bottom')
      moveFocus('bottom')
    }
  }

  const summary = `主光：${RELIGHT_DIRECTION_LABELS[value.direction]} · ${RELIGHT_QUALITY_LABELS[value.quality]} · ${RELIGHT_TEMPERATURE_LABELS[value.temperature]}`
  const hint = RELIGHT_DIRECTION_HINTS[value.direction]

  return (
    <div className={`relight-compass${isBack ? ' is-back' : ''}`}>
      <div className="relight-compass-head">
        <span className="relight-compass-label">光线方向</span>
        <span className="relight-compass-summary">{summary}</span>
      </div>
      <div className="relight-presets" role="group" aria-label="光线预设">
        {PRESETS.map(preset => {
          const active = value.direction === preset.value.direction
            && value.quality === preset.value.quality
            && value.temperature === preset.value.temperature
          return (
            <button
              key={preset.label}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onChange({ ...value, ...preset.value })}
            >
              {preset.label}
            </button>
          )
        })}
      </div>
      <div className="relight-compass-pad" role="radiogroup" aria-label="光线方向">
        <div className="relight-compass-grid">
          {CELLS.map(cell => {
            const selected = value.direction === cell.id
            return (
              <button
                key={cell.id}
                ref={node => {
                  if (node) cellRefs.current.set(cell.id, node)
                  else cellRefs.current.delete(cell.id)
                }}
                type="button"
                role="radio"
                className="relight-compass-cell"
                style={{ gridRow: cell.row + 1, gridColumn: cell.col + 1 }}
                aria-label={`${cell.label}光：${RELIGHT_DIRECTION_HINTS[cell.id]}`}
                aria-checked={selected}
                tabIndex={disabled ? -1 : selected ? 0 : -1}
                disabled={disabled}
                onClick={() => select(cell.id)}
                onKeyDown={event => onCellKeyDown(event, cell)}
              >
                <ArrowUpOutlined rotate={cell.rotate} aria-hidden="true" />
                <span>{cell.label}</span>
              </button>
            )
          })}
          <div className="relight-compass-center" style={{ gridRow: 2, gridColumn: 2 }} aria-hidden="true">
            <ProductGlyph />
            <span>商品</span>
          </div>
        </div>
        <div className="relight-depth">
          {DEPTH_OPTIONS.map(option => {
            const selected = value.direction === option.id
            return (
              <button
                key={option.id}
                ref={node => {
                  if (node) cellRefs.current.set(option.id, node)
                  else cellRefs.current.delete(option.id)
                }}
                type="button"
                role="radio"
                aria-label={`${option.label}：${RELIGHT_DIRECTION_HINTS[option.id]}`}
                aria-checked={selected}
                tabIndex={disabled ? -1 : selected ? 0 : -1}
                disabled={disabled}
                onClick={() => select(option.id)}
                onKeyDown={event => onDepthKeyDown(event, option.id)}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>
      <p className="relight-compass-hint">{hint}</p>
      <p className="sr-only" aria-live="polite">{summary}。{hint}</p>
    </div>
  )
}
