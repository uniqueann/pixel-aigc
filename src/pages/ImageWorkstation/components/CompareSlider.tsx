import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { comparePositionFromClientX } from '../utils/compareSlider'

interface Size {
  width: number
  height: number
}

interface Props {
  beforeSrc: string
  afterSrc: string
  beforeSize?: Size
  afterSize?: Size
}

const MIN_POSITION = 0
const MAX_POSITION = 100
const DEFAULT_POSITION = 50
/** 指针移动超过该距离才算拖动，避免点击或纵向滚动误改分割线。 */
const DRAG_THRESHOLD = 4

const clampPosition = (value: number) => Math.min(MAX_POSITION, Math.max(MIN_POSITION, value))

/** 精修结果的原图/结果同屏对比；分割线支持拖动、点击、键盘与双击复位。 */
export default function CompareSlider({ beforeSrc, afterSrc, beforeSize, afterSize }: Props) {
  const [position, setPosition] = useState(DEFAULT_POSITION)
  const positionRef = useRef(DEFAULT_POSITION)
  const [actualSize, setActualSize] = useState(false)
  const [naturalSize, setNaturalSize] = useState<Size>()
  const scrollRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; active: boolean }>()

  const applyPosition = useCallback((value: number) => {
    const next = clampPosition(value)
    positionRef.current = next
    setPosition(next)
  }, [])

  const updateFromClientX = useCallback((clientX: number) => {
    const rect = frameRef.current?.getBoundingClientRect()
    if (!rect) return
    const next = comparePositionFromClientX(clientX, rect)
    if (next !== undefined) applyPosition(next)
  }, [applyPosition])

  const centerScroll = useCallback(() => {
    const scroller = scrollRef.current
    const frame = frameRef.current
    if (!scroller || !frame) return
    const dividerX = frame.offsetWidth * positionRef.current / 100
    scroller.scrollLeft = Math.max(0, dividerX - scroller.clientWidth / 2)
    scroller.scrollTop = Math.max(0, (frame.offsetHeight - scroller.clientHeight) / 2)
  }, [])

  // 1:1 时把视口居中到分割线，避免 2K/4K 结果的分割线落在视口外。
  useEffect(() => {
    if (actualSize) centerScroll()
  }, [actualSize, centerScroll])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false }
    try { frameRef.current?.setPointerCapture(event.pointerId) } catch { /* 测试环境可能没有指针捕获。 */ }
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.active) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return
      // 纵向手势交给页面滚动，不抢占成分割线拖动。
      if (Math.abs(dx) <= Math.abs(dy)) return
      drag.active = true
    }
    updateFromClientX(event.clientX)
  }

  const endPointer = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    // 没有发生拖动时按点击处理；纵向滑动超过阈值则视为滚动，不跳转。
    if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD) {
      updateFromClientX(event.clientX)
    }
    dragRef.current = undefined
    try { frameRef.current?.releasePointerCapture(event.pointerId) } catch { /* 已经释放。 */ }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 1 : 5
    let next: number | undefined
    switch (event.key) {
      case 'ArrowLeft': next = position - step; break
      case 'ArrowRight': next = position + step; break
      case 'PageUp': next = position - 10; break
      case 'PageDown': next = position + 10; break
      case 'Home': next = MIN_POSITION; break
      case 'End': next = MAX_POSITION; break
      default: return
    }
    event.preventDefault()
    applyPosition(next)
  }

  const frameSize = actualSize ? naturalSize ?? afterSize ?? beforeSize : undefined
  const actualAvailable = Boolean(naturalSize ?? afterSize ?? beforeSize)
  const resetPosition = () => {
    applyPosition(DEFAULT_POSITION)
    if (actualSize) window.requestAnimationFrame(centerScroll)
  }

  return (
    <div className="workstation-compare-wrap">
      <div ref={scrollRef} className={`workstation-compare-scroll${actualSize ? ' is-actual' : ''}`}>
        <div
          ref={frameRef}
          className="workstation-compare"
          style={frameSize ? { width: frameSize.width, height: frameSize.height } : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onDoubleClick={resetPosition}
        >
          <div className="workstation-compare-layer is-after">
            <img
              src={afterSrc}
              alt="当前编辑效果"
              draggable={false}
              onLoad={(event) => {
                const { naturalWidth, naturalHeight } = event.currentTarget
                if (naturalWidth <= 0 || naturalHeight <= 0) return
                setNaturalSize((current) => current?.width === naturalWidth && current.height === naturalHeight
                  ? current
                  : { width: naturalWidth, height: naturalHeight })
              }}
            />
          </div>
          <div
            className="workstation-compare-layer is-before"
            style={{ clipPath: `inset(0 ${MAX_POSITION - position}% 0 0)` }}
            aria-hidden="true"
          >
            <img src={beforeSrc} alt="" draggable={false} />
          </div>
          <div
            className="workstation-compare-divider"
            style={{ left: `${position}%` }}
            role="slider"
            tabIndex={0}
            aria-label="对比原图与结果"
            aria-orientation="horizontal"
            aria-valuemin={MIN_POSITION}
            aria-valuemax={MAX_POSITION}
            aria-valuenow={Math.round(position)}
            aria-valuetext={`原图 ${Math.round(position)}%，精修后 ${Math.round(MAX_POSITION - position)}%`}
            onKeyDown={onKeyDown}
          >
            <span className="workstation-compare-handle" aria-hidden="true" />
          </div>
          <span className="workstation-compare-label is-before">原图</span>
          <span className="workstation-compare-label is-after">精修后</span>
        </div>
      </div>
      <button
        type="button"
        className="workstation-compare-zoom"
        aria-pressed={actualSize}
        title={actualSize ? '适应画布' : '按实际像素查看（1:1）'}
        disabled={!actualAvailable}
        onClick={() => setActualSize((value) => !value)}
      >
        1:1
      </button>
    </div>
  )
}
