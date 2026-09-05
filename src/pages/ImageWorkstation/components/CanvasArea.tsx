import { lazy, Suspense, useCallback, useRef, useState } from 'react'
import { Segmented } from 'antd'
import type { InteractionMode } from '../tools'
import BrushToolbar, { type PaintTool } from './canvas/BrushToolbar'
import type { MaskPaintCanvasHandle } from './canvas/MaskPaintCanvas'
import type { OutpaintCanvasHandle } from './canvas/OutpaintCanvas'

const MaskPaintCanvas = lazy(() => import('./canvas/MaskPaintCanvas'))
const OutpaintCanvas = lazy(() => import('./canvas/OutpaintCanvas'))

export type CanvasHandle = MaskPaintCanvasHandle | OutpaintCanvasHandle

interface Props {
  interactionMode: InteractionMode
  imageUrl: string
  imageNaturalSize: { width: number; height: number }
  presetTargetSize?: { width: number; height: number }
  onReady: (handle: CanvasHandle | null) => void
}

const canvasShellStyle = {
  flex: 1,
  border: '1px dashed var(--color-border-strong)',
  borderRadius: 10,
  background: 'var(--color-canvas)',
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  position: 'relative' as const,
  overflow: 'auto',
  minWidth: 0,
}

/** 根据交互模式装配真实画布或保留对应占位界面 */
export default function CanvasArea({ interactionMode, imageUrl, imageNaturalSize, presetTargetSize, onReady }: Props) {
  const maskHandleRef = useRef<MaskPaintCanvasHandle | null>(null)
  const [brushSize, setBrushSize] = useState(28)
  const [paintTool, setPaintTool] = useState<PaintTool>('brush')
  const [smartSelectEnabled, setSmartSelectEnabled] = useState(false)
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false })

  const setMaskHandle = useCallback(
    (handle: MaskPaintCanvasHandle | null) => {
      maskHandleRef.current = handle
      onReady(handle)
    },
    [onReady],
  )

  const setOutpaintHandle = useCallback(
    (handle: OutpaintCanvasHandle | null) => {
      onReady(handle)
    },
    [onReady],
  )

  const selectPaintTool = (tool: PaintTool) => {
    setPaintTool(tool)
    setSmartSelectEnabled(false)
  }

  if (interactionMode === 'mask-paint') {
    return (
      <div style={canvasShellStyle}>
        <div style={{ position: 'absolute', top: 12, zIndex: 3 }}>
          <BrushToolbar
            brushSize={brushSize}
            tool={paintTool}
            smartSelectEnabled={smartSelectEnabled}
            canUndo={historyState.canUndo}
            canRedo={historyState.canRedo}
            onBrushSizeChange={setBrushSize}
            onToolChange={selectPaintTool}
            onSmartSelectToggle={() => setSmartSelectEnabled((enabled) => !enabled)}
            onUndo={() => maskHandleRef.current?.undo()}
            onRedo={() => maskHandleRef.current?.redo()}
            onClear={() => maskHandleRef.current?.clear()}
          />
        </div>
        <Suspense fallback={<div style={{ color: 'var(--color-text-muted)' }}>正在加载蒙版画布…</div>}>
          <MaskPaintCanvas
            ref={setMaskHandle}
            imageUrl={imageUrl}
            brushSize={brushSize}
            tool={paintTool}
            smartSelectEnabled={smartSelectEnabled}
            onHistoryChange={setHistoryState}
          />
        </Suspense>
        {smartSelectEnabled ? (
          <div style={{ position: 'absolute', bottom: 12, color: 'var(--color-text-secondary)', fontSize: 12 }}>
            点击商品主体以创建智能选区
          </div>
        ) : null}
      </div>
    )
  }

  if (interactionMode === 'drag-resize') {
    return (
      <div style={canvasShellStyle}>
        <div style={{ position: 'absolute', top: 12, zIndex: 3, color: 'var(--color-text-secondary)', fontSize: 12 }}>
          {presetTargetSize ? '已按平台预设自动居中' : '拖拽绿色边框的控制点调整扩图范围'}
        </div>
        <Suspense fallback={<div style={{ color: 'var(--color-text-muted)' }}>正在加载扩图画布…</div>}>
          <OutpaintCanvas
            ref={setOutpaintHandle}
            imageUrl={imageUrl}
            imageNaturalSize={imageNaturalSize}
            presetTargetSize={presetTargetSize}
          />
        </Suspense>
      </div>
    )
  }

  return (
    <div style={canvasShellStyle}>
      <div style={{ position: 'absolute', top: 12 }}>
        <Segmented options={['原图', '效果']} />
      </div>
      <img src={imageUrl} alt="待处理原图" style={{ maxWidth: '72%', maxHeight: '72%', objectFit: 'contain' }} />
      <div style={{ position: 'absolute', bottom: 12, color: 'var(--color-text-muted)', fontSize: 12 }}>
        当前交互模式：{interactionMode}
      </div>
    </div>
  )
}
