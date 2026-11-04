import { useEffect, useId, useRef, useState, type PointerEvent } from 'react'
import type { RelightDirection } from '@shared/relight'
import { directionFromPoint } from './relightDirection'
import { relightOverlayGeometry } from './relightOverlayGeometry'

interface Props {
  direction: RelightDirection
  disabled?: boolean
  muted?: boolean
  onDirectionChange?: (direction: RelightDirection) => void
}

function LightGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="3.2" fill="currentColor" />
      <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  )
}

/** 镜头徽标：正面光的光源在镜头方向，不能用底部箭头表达。 */
function CameraGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.6" />
      <circle cx="12" cy="13" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

/** 预览图上的方向示意：平面光用实线主光箭头，正面用镜头徽标，逆光用背后辉光；虚线始终表示投影。 */
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
  const center = { x: width / 2, y: height / 2 }
  const geometry = relightOverlayGeometry(direction, width, height)
  const isPlanar = geometry.kind === 'planar'
  const isFront = geometry.kind === 'front'
  const isBack = geometry.kind === 'back'

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
    <div
      ref={rootRef}
      className={`relight-direction-overlay${muted ? ' is-muted' : ''}`}
      data-direction={direction}
      data-kind={geometry.kind}
      aria-hidden="true"
    >
      {width > 0 && height > 0 ? (
        <>
          <svg viewBox={`0 0 ${width} ${height}`} focusable="false">
            <defs>
              <marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-accent-text)" />
              </marker>
            </defs>
            <line
              data-role="shadow"
              x1={geometry.shadowStart.x}
              y1={geometry.shadowStart.y}
              x2={geometry.shadowEnd.x}
              y2={geometry.shadowEnd.y}
              stroke="var(--color-text-secondary-strong)"
              strokeDasharray="4 6"
              strokeLinecap="round"
              strokeWidth="1.5"
              opacity=".75"
            />
            <ellipse
              cx={geometry.shadowEnd.x}
              cy={geometry.shadowEnd.y}
              rx="12"
              ry="4"
              fill="var(--color-text-muted)"
              opacity=".45"
              transform={`rotate(${geometry.shadowAngle + 90} ${geometry.shadowEnd.x} ${geometry.shadowEnd.y})`}
            />
            {isPlanar && geometry.lightStart && geometry.lightEnd ? (
              <line
                data-role="main-light"
                x1={geometry.lightStart.x}
                y1={geometry.lightStart.y}
                x2={geometry.lightEnd.x}
                y2={geometry.lightEnd.y}
                stroke="var(--color-accent-text)"
                strokeLinecap="round"
                strokeWidth="2"
                markerEnd={`url(#${markerId})`}
              />
            ) : null}
            {isBack && geometry.rimRadius ? (
              <path
                data-role="rim-light"
                d={`M ${center.x - geometry.rimRadius} ${center.y - geometry.rimRadius * 0.15} A ${geometry.rimRadius} ${geometry.rimRadius} 0 0 1 ${center.x + geometry.rimRadius} ${center.y - geometry.rimRadius * 0.15}`}
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
            className={`relight-light-handle is-${geometry.kind}`}
            style={{ left: geometry.handle.x - 22, top: geometry.handle.y - 22 }}
            tabIndex={-1}
            disabled={disabled || !onDirectionChange}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={stopDragging}
            onPointerCancel={stopDragging}
          >
            <span className={`relight-light-dot is-${geometry.kind}`}>
              {isFront ? <CameraGlyph /> : <LightGlyph />}
            </span>
          </button>
          {isPlanar ? null : (
            <span
              className={`relight-overlay-tag is-${geometry.kind}`}
              style={{
                left: geometry.handle.x,
                top: isFront ? geometry.handle.y - 36 : geometry.handle.y + 28,
              }}
            >
              {isFront ? '镜头光' : '逆光'}
            </span>
          )}
        </>
      ) : null}
    </div>
  )
}
