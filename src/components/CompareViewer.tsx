import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { Button, Modal, Spin } from 'antd'
import type { PreviewItem } from './PreviewGallery'

interface Props {
  items: PreviewItem[]
  current: number
  onChange: (index: number) => void
  onClose: () => void
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function ImageLayer({ src, label, transform }: { src: string; label: string; transform: string }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  return <>
    {status === 'loading' && <div className="compare-image-status"><Spin /></div>}
    {status === 'error' && <div className="compare-image-status"><span>{label}加载失败</span><Button onClick={() => { setStatus('loading'); setAttempt(value => value + 1) }}>重试</Button></div>}
    <img
      key={attempt}
      src={src}
      alt={label}
      draggable={false}
      onLoad={() => setStatus('ready')}
      onError={() => setStatus('error')}
      style={{ transform, visibility: status === 'ready' ? 'visible' : 'hidden' }}
    />
  </>
}

export default function CompareViewer({ items, current, onChange, onClose }: Props) {
  const item = items[current]
  const [position, setPosition] = useState(50)
  const [scale, setScale] = useState(1)
  const [translation, setTranslation] = useState({ x: 0, y: 0 })
  const [holding, setHolding] = useState(false)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const detachWheel = useRef<(() => void) | undefined>()
  const setScaleRef = useRef(setScale)
  setScaleRef.current = setScale
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ mode: 'slide' | 'pan' | 'pinch'; distance?: number; center?: { x: number; y: number } }>({ mode: 'pan' })

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space') { event.preventDefault(); setHolding(true) }
      if (event.key === 'ArrowLeft' && current > 0) { event.preventDefault(); onChange(current - 1) }
      if (event.key === 'ArrowRight' && current < items.length - 1) { event.preventDefault(); onChange(current + 1) }
    }
    const keyUp = (event: KeyboardEvent) => { if (event.code === 'Space') setHolding(false) }
    const resetHolding = () => setHolding(false)
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', resetHolding)
    return () => { window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('blur', resetHolding) }
  }, [current, items.length, onChange])

  useEffect(() => () => detachWheel.current?.(), [])

  const setStage = useCallback((node: HTMLDivElement | null) => {
    detachWheel.current?.()
    detachWheel.current = undefined
    stageRef.current = node
    if (!node) return
    const onWheel = (event: WheelEvent) => {
      if (!node.contains(event.target as Node)) return
      if (event.cancelable) event.preventDefault()
      setScaleRef.current(value => clamp(value * (event.deltaY < 0 ? 1.12 : 1 / 1.12), 1, 8))
    }
    const hosts = new Set<EventTarget>([node])
    const wrap = node.closest('.ant-modal-wrap, .ant-modal-root, .compare-modal')
    if (wrap) hosts.add(wrap)
    for (const host of hosts) host.addEventListener('wheel', onWheel, { passive: false, capture: true })
    detachWheel.current = () => {
      for (const host of hosts) host.removeEventListener('wheel', onWheel, true)
    }
  }, [])

  if (!item?.originalSrc) return null

  const updatePosition = (x: number) => {
    const bounds = stageRef.current?.getBoundingClientRect()
    if (bounds) setPosition(clamp((x - bounds.left) / bounds.width * 100, 0, 100))
  }
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    stageRef.current?.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      gesture.current = { mode: 'pinch', distance: Math.hypot(a.x - b.x, a.y - b.y), center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
    } else if ((event.target as HTMLElement).closest('.compare-divider')) {
      gesture.current = { mode: 'slide' }
      updatePosition(event.clientX)
    } else gesture.current = { mode: 'pan' }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId)
    if (!previous) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (gesture.current.mode === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const previousDistance = gesture.current.distance
      const previousCenter = gesture.current.center
      if (previousDistance) setScale(value => clamp(value * distance / previousDistance, 1, 8))
      if (previousCenter) setTranslation(value => ({ x: value.x + center.x - previousCenter.x, y: value.y + center.y - previousCenter.y }))
      gesture.current = { mode: 'pinch', distance, center }
    } else if (gesture.current.mode === 'slide') updatePosition(event.clientX)
    else setTranslation(value => ({ x: value.x + event.clientX - previous.x, y: value.y + event.clientY - previous.y }))
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) gesture.current = { mode: 'pan' }
  }
  const reset = () => { setScale(1); setTranslation({ x: 0, y: 0 }); setPosition(50) }
  const transform = `translate3d(${translation.x}px, ${translation.y}px, 0) scale(${scale})`

  return <Modal
    open
    footer={null}
    onCancel={onClose}
    width="100vw"
    className="compare-modal"
    centered
    styles={{ mask: { background: 'rgba(0,0,0,0.85)' } }}
    title={item.title ?? '原图 / 结果对比'}
  >
    <div className="compare-controls">
      <span>左：原图 · 右：结果</span>
      <Button onPointerDown={() => setHolding(true)} onPointerUp={() => setHolding(false)} onPointerCancel={() => setHolding(false)} onPointerLeave={() => setHolding(false)}>按住查看原图（空格）</Button>
      <Button onClick={reset}>重置视图</Button>
    </div>
    <div
      ref={setStage}
      className="compare-stage"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={reset}
      role="img"
      aria-label="拖动分割线对比原图和结果；双击重置视图"
    >
      <div className="compare-layer"><ImageLayer src={item.fullSrc} label="结果图" transform={transform} /></div>
      <div className="compare-layer compare-original-layer" style={{ clipPath: holding ? undefined : `inset(0 ${100 - position}% 0 0)` }}><ImageLayer src={item.originalSrc} label="原图" transform={transform} /></div>
      {!holding && <div className="compare-divider" style={{ left: `${position}%` }}><span>↔</span></div>}
      <span className="compare-label compare-label-left">原图</span>
      <span className="compare-label compare-label-right">结果</span>
    </div>
    <div className="compare-navigation">
      <Button disabled={current === 0} onClick={() => onChange(current - 1)}>上一张</Button>
      <span>{current + 1} / {items.length}</span>
      <Button disabled={current >= items.length - 1} onClick={() => onChange(current + 1)}>下一张</Button>
    </div>
  </Modal>
}
