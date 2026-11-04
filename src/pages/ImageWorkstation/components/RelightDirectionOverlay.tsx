import { useEffect, useId, useRef, useState, type PointerEvent } from 'react'
import type { RelightDirection } from '@shared/relight'
import { directionFromPoint } from './relightDirection'

interface Props {
  direction: RelightDirection
  disabled?: boolean
  muted?: boolean
  onDirectionChange?: (direction: RelightDirection) => void
}

const PLANAR_UNITS: Record<Exclude<RelightDirection, 'front' | 'back'>, { x: number; y: number }> = {
  top: { x: 0, y: -1 },
  'top-right': { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
  right: { x: 1, y: 0 },
  'bottom-right': { x: Math.SQRT1_2, y: Math.SQRT1_2 },
  bottom: { x: 0, y: 1 },
  'bottom-left': { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
  left: { x: -1, y: 0 },
  'top-left': { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
}

function unitFor(direction: RelightDirection) {
  if (direction === 'front') return { x: 0, y: 1 }
  if (direction === 'back') return { x: 0, y: -1 }
  return PLANAR_UNITS[direction]
}

function LightGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="3.2" fill="currentColor" />
      <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  )
}

/** 预览图上的方向示意：主光箭头 + 虚线投影，并提供可拖动的光源手柄。 */
export default function RelightDirectionOverlay({ direction, disabled = false, muted = false, onDirectionChange }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const markerId = `relight-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

  useEffect(() => {
    const node = rootRef.current
    if (!node) return
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect
      if (!rect) return
      setSize(current => (
        Math.round(current.width) === Math.round(rect.width) && Math.round(current.height) === Math.round(rect.height)
          ? current
          : { width: rect.width, height: rect.height }
      ))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const { width, height } = size
  const min = Math.min(width, height)
  const center = { x: width / 2, y: height / 2 }
  const outer = Math.max(0, min / 2 - 30)
  const inner = Math.max(18, min * 0.17)
  const unit = unitFor(direction)
  const lightStart = { x: center.x + unit.x * outer, y: center.y + unit.y * outer }
  const lightEnd = { x: center.x + unit.x * inner, y: center.y + unit.y * inner }
  const shadowStart = { x: center.x - unit.x * inner, y: center.y - unit.y * inner }
  const shadowEnd = { x: center.x - unit.x * outer, y: center.y - unit.y * outer }
  const shadowAngle = Math.atan2(shadowEnd.y - shadowStart.y, shadowEnd.x - shadowStart.x) * 180 / Math.PI
  const isBack = direction === 'back'
  const rimRadius = Math.max(24, inner * 0.95)

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (disabled || !onDirectionChange) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    draggingRef.current = true
  }

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!draggingRef.current || disabled || !onDirectionChange) return
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return
    const next = directionFromPoint(
      event.clientX - (rect.left + rect.width / 2),
      event.clientY - (rect.top + rect.height / 2),
      Math.min(rect.width, rect.height),
    )
    if (next !== direction) onDirectionChange(next)
  }

  const stopDragging = (event: PointerEvent<HTMLButtonElement>) => {
    draggingRef.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div ref={rootRef} className={`relight-direction-overlay${muted ? ' is-muted' : ''}`} aria-hidden="true">
      {width > 0 && height > 0 ? (
        <>
          <svg viewBox={`0 0 ${width} ${height}`} focusable="false">
            <defs>
              <marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-accent-text)" />
              </marker>
            </defs>
            <line
              x1={shadowStart.x}
              y1={shadowStart.y}
              x2={shadowEnd.x}
              y2={shadowEnd.y}
              stroke="var(--color-text-secondary-strong)"
              strokeDasharray="4 6"
              strokeLinecap="round"
              strokeWidth="1.5"
              opacity=".75"
            />
            <ellipse
              cx={shadowEnd.x}
              cy={shadowEnd.y}
              rx="12"
              ry="4"
              fill="var(--color-text-muted)"
              opacity=".45"
              transform={`rotate(${shadowAngle + 90} ${shadowEnd.x} ${shadowEnd.y})`}
            />
            <line
              x1={lightStart.x}
              y1={lightStart.y}
              x2={lightEnd.x}
              y2={lightEnd.y}
              stroke="var(--color-accent-text)"
              strokeDasharray={isBack ? '5 5' : undefined}
              strokeLinecap="round"
              strokeWidth="2"
              markerEnd={`url(#${markerId})`}
            />
            {isBack ? (
              <path
                d={`M ${center.x - rimRadius} ${center.y - rimRadius * 0.15} A ${rimRadius} ${rimRadius} 0 0 1 ${center.x + rimRadius} ${center.y - rimRadius * 0.15}`}
                fill="none"
                stroke="var(--color-accent-text)"
                strokeLinecap="round"
                strokeWidth="2"
                opacity=".8"
              />
            ) : null}
          </svg>
          <button
            type="button"
            className="relight-light-handle"
            style={{ left: lightStart.x - 22, top: lightStart.y - 22 }}
            tabIndex={-1}
            disabled={disabled || !onDirectionChange}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={stopDragging}
            onPointerCancel={stopDragging}
          >
            <span className="relight-light-dot"><LightGlyph /></span>
          </button>
        </>
      ) : null}
    </div>
  )
}
