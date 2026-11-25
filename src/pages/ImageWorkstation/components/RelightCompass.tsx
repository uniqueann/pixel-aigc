import { useRef, type KeyboardEvent } from 'react'
import { ArrowUpOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import type {
  RelightDirection,
  RelightOptions,
  RelightQuality,
  RelightTemperature,
} from '@shared/relight'

interface Props {
  value: RelightOptions
  disabled?: boolean
  onChange: (value: RelightOptions) => void
}

const DIRECTION_LABEL_KEYS = {
  left: 'relight.directions.left',
  right: 'relight.directions.right',
  top: 'relight.directions.top',
  bottom: 'relight.directions.bottom',
  front: 'relight.directions.front',
  back: 'relight.directions.back',
  'top-left': 'relight.directions.top-left',
  'top-right': 'relight.directions.top-right',
  'bottom-left': 'relight.directions.bottom-left',
  'bottom-right': 'relight.directions.bottom-right',
} as const satisfies Record<RelightDirection, string>

const DIRECTION_HINT_KEYS = {
  top: 'relight.directionHints.top',
  left: 'relight.directionHints.left',
  right: 'relight.directionHints.right',
  front: 'relight.directionHints.front',
  bottom: 'relight.directionHints.bottom',
  back: 'relight.directionHints.back',
  'top-left': 'relight.directionHints.top-left',
  'top-right': 'relight.directionHints.top-right',
  'bottom-left': 'relight.directionHints.bottom-left',
  'bottom-right': 'relight.directionHints.bottom-right',
} as const satisfies Record<RelightDirection, string>

const QUALITY_LABEL_KEYS = {
  soft: 'relight.qualities.soft',
  hard: 'relight.qualities.hard',
} as const satisfies Record<RelightQuality, string>

const TEMPERATURE_LABEL_KEYS = {
  warm: 'relight.temperatures.warm',
  neutral: 'relight.temperatures.neutral',
  cool: 'relight.temperatures.cool',
} as const satisfies Record<RelightTemperature, string>

interface CompassCell {
  id: RelightDirection
  labelKey: (typeof DIRECTION_LABEL_KEYS)[RelightDirection]
  row: number
  col: number
  /** 箭头指向商品中心；顶部为 0°，顺时针。 */
  rotate: number
}

interface RelightPreset {
  id: string
  labelKey: 'relight.presets.studioSoft' | 'relight.presets.sunsetWarm' | 'relight.presets.coolRim'
  value: Pick<RelightOptions, 'direction' | 'quality' | 'temperature'>
}

/** 三个常用起点，避免用户在 10×2×3 的组合里从零开始。 */
const PRESETS: RelightPreset[] = [
  { id: 'studio-soft', labelKey: 'relight.presets.studioSoft', value: { direction: 'front', quality: 'soft', temperature: 'neutral' } },
  { id: 'sunset-warm', labelKey: 'relight.presets.sunsetWarm', value: { direction: 'bottom-left', quality: 'soft', temperature: 'warm' } },
  { id: 'cool-rim', labelKey: 'relight.presets.coolRim', value: { direction: 'back', quality: 'hard', temperature: 'cool' } },
]

/** 八个平面方位；中心留给商品图形，正面/逆光由下方深度行表达。 */
const CELLS: CompassCell[] = [
  { id: 'top-left', labelKey: DIRECTION_LABEL_KEYS['top-left'], row: 0, col: 0, rotate: 135 },
  { id: 'top', labelKey: DIRECTION_LABEL_KEYS.top, row: 0, col: 1, rotate: 180 },
  { id: 'top-right', labelKey: DIRECTION_LABEL_KEYS['top-right'], row: 0, col: 2, rotate: 225 },
  { id: 'left', labelKey: DIRECTION_LABEL_KEYS.left, row: 1, col: 0, rotate: 90 },
  { id: 'right', labelKey: DIRECTION_LABEL_KEYS.right, row: 1, col: 2, rotate: 270 },
  { id: 'bottom-left', labelKey: DIRECTION_LABEL_KEYS['bottom-left'], row: 2, col: 0, rotate: 45 },
  { id: 'bottom', labelKey: DIRECTION_LABEL_KEYS.bottom, row: 2, col: 1, rotate: 0 },
  { id: 'bottom-right', labelKey: DIRECTION_LABEL_KEYS['bottom-right'], row: 2, col: 2, rotate: 315 },
]

const DEPTH_OPTIONS = [
  { id: 'front', labelKey: DIRECTION_LABEL_KEYS.front },
  { id: 'back', labelKey: DIRECTION_LABEL_KEYS.back },
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
  const { t } = useTranslation('workstation')
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

  const summary = t('relight.compass.summary', {
    direction: t(DIRECTION_LABEL_KEYS[value.direction]),
    quality: t(QUALITY_LABEL_KEYS[value.quality]),
    temperature: t(TEMPERATURE_LABEL_KEYS[value.temperature]),
  })
  const directionHint = t(DIRECTION_HINT_KEYS[value.direction])
  const hint = isBack
    ? t('relight.compass.backHint', { hint: directionHint })
    : directionHint

  return (
    <div className={`relight-compass${isBack ? ' is-back' : ''}`}>
      <div className="relight-compass-head">
        <span className="relight-compass-label">{t('relight.compass.label')}</span>
        <span className="relight-compass-summary">{summary}</span>
      </div>
      <div className="relight-presets" role="group" aria-label={t('relight.compass.presetsAria')}>
        {PRESETS.map(preset => {
          const active = value.direction === preset.value.direction
            && value.quality === preset.value.quality
            && value.temperature === preset.value.temperature
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onChange({ ...value, ...preset.value })}
            >
              {t(preset.labelKey)}
            </button>
          )
        })}
      </div>
      <div className="relight-compass-pad" role="radiogroup" aria-label={t('relight.compass.directionAria')}>
        <div className="relight-compass-grid">
          {CELLS.map(cell => {
            const selected = value.direction === cell.id
            const label = t(cell.labelKey)
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
                aria-label={t('relight.compass.cellAria', {
                  label,
                  hint: t(DIRECTION_HINT_KEYS[cell.id]),
                })}
                aria-checked={selected}
                tabIndex={disabled ? -1 : selected ? 0 : -1}
                disabled={disabled}
                onClick={() => select(cell.id)}
                onKeyDown={event => onCellKeyDown(event, cell)}
              >
                <ArrowUpOutlined rotate={cell.rotate} aria-hidden="true" />
                <span>{label}</span>
              </button>
            )
          })}
          <div className="relight-compass-center" style={{ gridRow: 2, gridColumn: 2 }} aria-hidden="true">
            <ProductGlyph />
            <span>{t('relight.compass.product')}</span>
          </div>
        </div>
        <div className="relight-depth">
          {DEPTH_OPTIONS.map(option => {
            const selected = value.direction === option.id
            const label = t(option.labelKey)
            return (
              <button
                key={option.id}
                ref={node => {
                  if (node) cellRefs.current.set(option.id, node)
                  else cellRefs.current.delete(option.id)
                }}
                type="button"
                role="radio"
                aria-label={t('relight.compass.depthAria', {
                  label,
                  hint: t(DIRECTION_HINT_KEYS[option.id]),
                })}
                aria-checked={selected}
                tabIndex={disabled ? -1 : selected ? 0 : -1}
                disabled={disabled}
                onClick={() => select(option.id)}
                onKeyDown={event => onDepthKeyDown(event, option.id)}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>
      <p className="relight-compass-hint">{hint}</p>
      <p className="sr-only" aria-live="polite">{t('relight.compass.srAnnouncement', { summary, hint })}</p>
    </div>
  )
}
