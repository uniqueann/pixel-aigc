import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SuiteAssetRef, SuiteComposition, SuiteLayer } from '@shared/ecommerce-suite'
import { moveSuiteLayer } from '@shared/ecommerce-suite-annotations'
import type { SuiteClient } from './api'
import { backupAssetBlob } from './recoveryPackage'
import { paintSuite, type SuiteLayerBox } from './render'

const PREVIEW_CACHE_LIMIT = 8

interface PreviewFrame { key: string; canvas: HTMLCanvasElement; boxes: SuiteLayerBox[] }
interface PaintedPreview { identity: string; boxes: SuiteLayerBox[] }
interface PreviewFailure { identity: string; message: string }

function frameKey(identity: string, composition: SuiteComposition, background: string) {
  const { width, height } = composition.renderSize
  return `${identity}\u0000${background}\u0000${width}x${height}\u0000${composition.unitSystem}\u0000${JSON.stringify(composition.layersSnapshot)}\u0000${JSON.stringify(composition.factsSnapshot)}`
}

function drawFrame(target: HTMLCanvasElement, source: HTMLCanvasElement) {
  target.width = source.width
  target.height = source.height
  const ctx = target.getContext('2d')
  if (!ctx) return false
  ctx.drawImage(source, 0, 0)
  return true
}

function rememberFrame(current: Map<string, PreviewFrame>, identity: string, frame: PreviewFrame) {
  const next = new Map(current)
  const previous = next.get(identity)
  if (previous && previous.canvas !== frame.canvas) { previous.canvas.width = 1; previous.canvas.height = 1 }
  next.delete(identity)
  next.set(identity, frame)
  while (next.size > PREVIEW_CACHE_LIMIT) {
    const oldest = next.keys().next().value
    if (oldest === undefined) break
    const dropped = next.get(oldest)
    next.delete(oldest)
    if (dropped) { dropped.canvas.width = 1; dropped.canvas.height = 1 }
  }
  return next
}

function rememberBitmap(cache: Map<string, ImageBitmap>, identity: string, image: ImageBitmap) {
  const existing = cache.get(identity)
  if (existing === image) { cache.delete(identity); cache.set(identity, image); return image }
  if (existing) existing.close()
  cache.delete(identity)
  cache.set(identity, image)
  while (cache.size > PREVIEW_CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.get(oldest)?.close()
    cache.delete(oldest)
  }
  return image
}

async function decodeSuiteBitmap(cache: Map<string, ImageBitmap>, identity: string, blob: Blob, signal: AbortSignal) {
  const existing = cache.get(identity)
  if (existing) return existing
  const image = await createImageBitmap(blob)
  if (signal.aborted) { image.close(); signal.throwIfAborted() }
  return rememberBitmap(cache, identity, image)
}

function DimensionHandles({ layer, width, height, onStart }: { layer: Extract<SuiteLayer, { type: 'dimension' }>; width: number; height: number;
  onStart: (event: React.PointerEvent<SVGCircleElement>, handle: 'start' | 'end' | 'label') => void }) {
  return <g>{(['start', 'end', 'label'] as const).map(handle => {
    const point = handle === 'label' ? layer.labelPosition : layer[handle]
    return <circle key={handle} cx={point.x * width} cy={point.y * height} r={Math.max(width / 70, 8)} fill="var(--color-surface)" stroke="var(--color-accent)" strokeWidth={width / 350}
      role="button" tabIndex={0} aria-label={handle === 'start' ? '移动标注起点' : handle === 'end' ? '移动标注终点' : '移动规格标签'} onPointerDown={event => onStart(event, handle)} />
  })}</g>
}

export default function SuiteCanvas({ asset, composition, client, signal, selectedId, onSelect, onChange, editable, background = 'transparent' }: {
  asset: SuiteAssetRef; composition: SuiteComposition; client: SuiteClient; signal: AbortSignal;
  selectedId?: string; onSelect: (id: string) => void; onChange: (layers: SuiteLayer[]) => void; editable: boolean
  background?: string
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [blobs, setBlobs] = useState(() => new Map<string, Blob>())
  const [frames, setFrames] = useState(() => new Map<string, PreviewFrame>())
  const [painted, setPainted] = useState<PaintedPreview | null>(null)
  const [failure, setFailure] = useState<PreviewFailure | null>(null)
  const [retry, setRetry] = useState(0)
  const drag = useRef<{ id: string; x: number; y: number; layer: SuiteLayer; handle: 'body' | 'start' | 'end' | 'label' }>()
  const bitmaps = useRef(new Map<string, ImageBitmap>())
  const inflight = useRef(new Set<string>())
  const loadToken = useRef(new Map<string, number>())
  const blobsRef = useRef(blobs)
  const assetRef = useRef(asset)
  const clientRef = useRef(client)
  const signalRef = useRef(signal)
  const identityRef = useRef('')
  const compositionRef = useRef(composition)
  const backgroundRef = useRef(background)
  const paintGeneration = useRef(0)
  const mounted = useRef(true)
  const assetIdentity = `${asset.projectId}:${asset.assetId}:${asset.checksum}`
  const previewKey = frameKey(assetIdentity, composition, background)
  const frame = frames.get(assetIdentity)
  const base = blobs.get(assetIdentity)
  // 只有当前槽位自己的画面可以露出来。已绘制过的槽位直接命中缓存；否则保持棋盘格，而不是上一张图。
  const showing = frame !== undefined || painted?.identity === assetIdentity
  const error = failure?.identity === assetIdentity ? failure.message : ''
  const displayedBoxes = !showing ? [] : frame?.key === previewKey ? frame.boxes : painted?.identity === assetIdentity ? painted.boxes : frame?.boxes ?? []
  useEffect(() => { assetRef.current = asset; clientRef.current = client; signalRef.current = signal }, [asset, client, signal])
  useEffect(() => () => {
    mounted.current = false
    for (const image of bitmaps.current.values()) image.close()
    bitmaps.current.clear()
  }, [])
  useLayoutEffect(() => { blobsRef.current = blobs }, [blobs])
  useLayoutEffect(() => {
    identityRef.current = assetIdentity
    compositionRef.current = composition
    backgroundRef.current = background
    const target = canvas.current
    if (!target) return
    if (frame?.key === previewKey) { drawFrame(target, frame.canvas); return }
    if (!showing) { target.width = 1; target.height = 1 }
    // previewKey 已覆盖图层、底色和资产内容；轮询只换对象引用时不能把画布清掉或重画。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetIdentity, previewKey, frame, showing])
  useEffect(() => {
    const identity = assetIdentity
    if (blobsRef.current.has(identity) || inflight.current.has(identity)) return
    const token = (loadToken.current.get(identity) ?? 0) + 1
    loadToken.current.set(identity, token)
    const current = assetRef.current
    const currentSignal = signalRef.current
    inflight.current.add(identity)
    void backupAssetBlob(current.actor, current, currentSignal).then(blob => {
      clientRef.current.assertCurrent()
      if (!mounted.current || loadToken.current.get(identity) !== token) return
      inflight.current.delete(identity)
      setBlobs(existing => existing.get(identity) === blob ? existing : new Map(existing).set(identity, blob))
    }).catch(error => {
      if (loadToken.current.get(identity) === token) inflight.current.delete(identity)
      if (!mounted.current || currentSignal.aborted || identityRef.current !== identity || loadToken.current.get(identity) !== token) return
      setFailure({ identity, message: error instanceof Error ? error.message : '图片不可用' })
    })
  }, [assetIdentity, retry])
  useEffect(() => {
    if (!base) return
    const identity = assetIdentity
    const key = previewKey
    const generation = ++paintGeneration.current
    if (frames.get(identity)?.key === key) return
    const abort = new AbortController()
    const buffer = document.createElement('canvas')
    const compositionNow = compositionRef.current
    const backgroundNow = backgroundRef.current
    let disposed = false
    // 离屏完成后再替换。绘制提交前核对代数和当前槽位，迟到的解码不能盖住后来的选择。
    void (async () => {
      try {
        const image = await decodeSuiteBitmap(bitmaps.current, identity, base, abort.signal)
        if (disposed || generation !== paintGeneration.current || identityRef.current !== identity) return
        const layout = await paintSuite(buffer, base, compositionNow, backgroundNow, abort.signal, image)
        if (disposed || generation !== paintGeneration.current || identityRef.current !== identity || !mounted.current || !canvas.current) return
        const snapshot = document.createElement('canvas')
        snapshot.width = buffer.width
        snapshot.height = buffer.height
        if (!drawFrame(snapshot, buffer) || !drawFrame(canvas.current, snapshot)) throw new Error('当前浏览器不能创建画板')
        const paintedFrame = { key, canvas: snapshot, boxes: layout }
        setFrames(current => rememberFrame(current, identity, paintedFrame))
        setPainted({ identity, boxes: layout })
        setFailure(current => current?.identity === identity ? null : current)
      } catch (error) {
        if (disposed || generation !== paintGeneration.current || identityRef.current !== identity || abort.signal.aborted) return
        setFailure({ identity, message: error instanceof Error ? error.message : '预览失败' })
      } finally { buffer.width = 1; buffer.height = 1 }
    })()
    return () => { disposed = true; abort.abort() }
  }, [base, previewKey, assetIdentity, frames])
  const { width, height } = composition.renderSize
  const selected = composition.layersSnapshot.find(layer => layer.id === selectedId)
  const overflow = displayedBoxes.some(box => box.x < 0 || box.y < 0 || box.x + box.width > width + .1 || box.y + box.height > height + .1)
  const start = (event: React.PointerEvent<SVGElement>, layer: SuiteLayer, handle: 'body' | 'start' | 'end' | 'label') => {
    if (!editable) return
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId)
    onSelect(layer.id); drag.current = { id: layer.id, layer, x: event.clientX, y: event.clientY, handle }
  }
  const retryRead = () => {
    inflight.current.delete(assetIdentity)
    const image = bitmaps.current.get(assetIdentity)
    if (image) { image.close(); bitmaps.current.delete(assetIdentity) }
    setBlobs(current => {
      if (!current.has(assetIdentity)) return current
      const next = new Map(current); next.delete(assetIdentity); return next
    })
    setFrames(current => {
      const previous = current.get(assetIdentity)
      if (!previous) return current
      previous.canvas.width = 1; previous.canvas.height = 1
      const next = new Map(current); next.delete(assetIdentity); return next
    })
    setPainted(current => current?.identity === assetIdentity ? null : current)
    setFailure(current => current?.identity === assetIdentity ? null : current)
    setRetry(value => value + 1)
  }
  const overlay = useRef<SVGSVGElement>(null)
  return <div className="suite-canvas-wrap" style={{ maxWidth: Math.min(480, 480 * width / height) }}>
    <div className="suite-canvas" style={{ aspectRatio: `${width}/${height}` }} aria-busy={!showing}>
      <canvas hidden={!showing} ref={canvas} aria-label="成品图层预览" />
      <svg ref={overlay} viewBox={`0 0 ${width} ${height}`} aria-label="图层位置编辑" tabIndex={editable ? 0 : -1}
        onPointerMove={event => {
          const current = drag.current, bounds = overlay.current?.getBoundingClientRect()
          if (!current || !bounds || !editable) return
          onChange(composition.layersSnapshot.map(layer => layer.id === current.id ? moveSuiteLayer(current.layer, (event.clientX - current.x) / bounds.width, (event.clientY - current.y) / bounds.height, current.handle) : layer))
        }} onPointerUp={() => { drag.current = undefined }} onPointerCancel={() => { drag.current = undefined }}
        onKeyDown={event => {
          if (!editable || !selected || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
          event.preventDefault()
          const amount = event.shiftKey ? 10 : 1
          onChange(composition.layersSnapshot.map(layer => layer.id !== selected.id ? layer : moveSuiteLayer(layer,
            event.key === 'ArrowLeft' ? -amount / width : event.key === 'ArrowRight' ? amount / width : 0,
            event.key === 'ArrowUp' ? -amount / height : event.key === 'ArrowDown' ? amount / height : 0)))
        }}>
        {editable && displayedBoxes.map(box => {
          const layer = composition.layersSnapshot.find(layer => layer.id === box.id)
          if (!layer) return null
          return <rect key={box.id} x={box.x} y={box.y} width={Math.max(20, box.width)} height={Math.max(20, box.height)} fill="transparent"
            stroke={box.id === selectedId ? 'var(--color-accent)' : 'transparent'} strokeWidth={Math.max(width / 400, 1)} strokeDasharray={box.id === selectedId ? '8 5' : undefined}
            role="button" aria-label={layer.type === 'text' ? `移动文字：${layer.text || '空文字'}` : '移动尺寸标注'} tabIndex={0}
            onFocus={() => onSelect(box.id)} onPointerDown={event => start(event, layer, 'body')} />
        })}
        {editable && selected?.type === 'dimension' && <DimensionHandles layer={selected} width={width} height={height} onStart={(event, handle) => start(event, selected, handle)} />}
      </svg>
    </div>
    {error && <div role="alert">{error} <button type="button" onClick={retryRead}>重试读取</button></div>}
    {overflow && <p role="alert" className="suite-layer-warning">文字或标注超出画板，请缩小字号或移动到画板内再导出。</p>}
  </div>
}
