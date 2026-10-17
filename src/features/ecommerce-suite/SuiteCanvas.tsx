import { useEffect, useRef, useState } from 'react'
import type { SuiteAssetRef, SuiteComposition, SuiteLayer } from '@shared/ecommerce-suite'
import { moveSuiteLayer } from '@shared/ecommerce-suite-annotations'
import type { SuiteClient } from './api'
import { backupAssetBlob } from './recoveryPackage'
import { paintSuite, type SuiteLayerBox } from './render'

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
  const [loaded, setLoaded] = useState<{ assetId: string; blob: Blob }>()
  const base = loaded?.assetId === asset.assetId ? loaded.blob : undefined
  const [boxes, setBoxes] = useState<SuiteLayerBox[]>([])
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const drag = useRef<{ id: string; x: number; y: number; layer: SuiteLayer; handle: 'body' | 'start' | 'end' | 'label' }>()
  useEffect(() => {
    let disposed = false
    void backupAssetBlob(asset.actor, asset, signal).then(blob => { client.assertCurrent(); if (!disposed) { setLoaded({ assetId: asset.assetId, blob }); setError('') } })
      .catch(error => { if (!disposed && !signal.aborted) setError(error instanceof Error ? error.message : '图片不可用') })
    return () => { disposed = true }
  }, [asset, client, signal, retry])
  useEffect(() => {
    if (!base) return
    let disposed = false
    const abort = new AbortController()
    // 离屏完成后再替换，旧字体或图片异步响应不能覆盖新草稿。
    const buffer = document.createElement('canvas')
    void paintSuite(buffer, base, composition, background, abort.signal).then(layout => {
      if (disposed || !canvas.current) return
      const target = canvas.current; target.width = buffer.width; target.height = buffer.height
      target.getContext('2d')?.drawImage(buffer, 0, 0); setBoxes(layout); setError('')
    }).catch(error => { if (!disposed) setError(error instanceof Error ? error.message : '预览失败') })
      .finally(() => { buffer.width = 1; buffer.height = 1 })
    return () => { disposed = true; abort.abort() }
  }, [base, composition, background])
  const { width, height } = composition.renderSize
  const selected = composition.layersSnapshot.find(layer => layer.id === selectedId)
  const overflow = boxes.some(box => box.x < 0 || box.y < 0 || box.x + box.width > width + .1 || box.y + box.height > height + .1)
  const start = (event: React.PointerEvent<SVGElement>, layer: SuiteLayer, handle: 'body' | 'start' | 'end' | 'label') => {
    if (!editable) return
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId)
    onSelect(layer.id); drag.current = { id: layer.id, layer, x: event.clientX, y: event.clientY, handle }
  }
  const overlay = useRef<SVGSVGElement>(null)
  return <div className="suite-canvas-wrap" style={{ maxWidth: Math.min(480, 480 * width / height) }}>
    <div className="suite-canvas" style={{ aspectRatio: `${width}/${height}` }}>
      <canvas hidden={!base} ref={canvas} aria-label="成品图层预览" />
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
        {editable && boxes.map(box => {
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
    {error && <div role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>重试读取</button></div>}
    {overflow && <p role="alert" className="suite-layer-warning">文字或标注超出画板，请缩小字号或移动到画板内再导出。</p>}
  </div>
}
