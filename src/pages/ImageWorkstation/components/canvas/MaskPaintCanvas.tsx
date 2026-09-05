import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Canvas, FabricImage, PencilBrush } from 'fabric'
import { smartSelect } from '@/services/api/smartSelect'
import { exportPaintedMask, type MaskExportResult } from '../../utils/maskExport'
import type { PaintTool } from './BrushToolbar'

const CANVAS_WIDTH = 640
const CANVAS_HEIGHT = 420
const MAX_HISTORY = 20

interface MaskPaintCanvasProps {
  imageUrl: string
  brushSize: number
  tool: PaintTool
  smartSelectEnabled: boolean
  onHistoryChange?: (state: { canUndo: boolean; canRedo: boolean }) => void
}

export interface MaskPaintCanvasHandle {
  exportMask: () => MaskExportResult
  clear: () => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

const MaskPaintCanvas = forwardRef<MaskPaintCanvasHandle, MaskPaintCanvasProps>(function MaskPaintCanvas(
  { imageUrl, brushSize, tool, smartSelectEnabled, onHistoryChange },
  ref,
) {
  const canvasElementRef = useRef<HTMLCanvasElement>(null)
  const fabricCanvasRef = useRef<Canvas | null>(null)
  const historyRef = useRef<string[]>([])
  const historyIndexRef = useRef(-1)
  const toolRef = useRef(tool)
  const brushSizeRef = useRef(brushSize)
  const smartSelectRef = useRef(smartSelectEnabled)
  const restoringRef = useRef(false)
  const selectingRef = useRef(false)
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false })

  const updateHistoryState = useCallback(
    (index: number, length: number) => {
      const next = { canUndo: index > 0, canRedo: index >= 0 && index < length - 1 }
      setHistoryState(next)
      onHistoryChange?.(next)
    },
    [onHistoryChange],
  )

  const pushSnapshot = useCallback(() => {
    const canvas = fabricCanvasRef.current
    if (!canvas || restoringRef.current) return

    const snapshot = JSON.stringify(canvas.toJSON())
    const nextHistory = historyRef.current.slice(0, historyIndexRef.current + 1)
    nextHistory.push(snapshot)
    if (nextHistory.length > MAX_HISTORY) nextHistory.shift()
    historyRef.current = nextHistory
    historyIndexRef.current = nextHistory.length - 1
    updateHistoryState(historyIndexRef.current, nextHistory.length)
  }, [updateHistoryState])

  const restoreSnapshot = useCallback(
    async (nextIndex: number) => {
      const canvas = fabricCanvasRef.current
      const snapshot = historyRef.current[nextIndex]
      if (!canvas || !snapshot) return

      restoringRef.current = true
      await canvas.loadFromJSON(snapshot)
      canvas.getObjects().forEach((object) => object.set({ selectable: false, evented: false }))
      canvas.requestRenderAll()
      historyIndexRef.current = nextIndex
      restoringRef.current = false
      updateHistoryState(nextIndex, historyRef.current.length)
    },
    [updateHistoryState],
  )

  const clear = useCallback(() => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return
    canvas.clear()
    canvas.requestRenderAll()
    pushSnapshot()
  }, [pushSnapshot])

  const undo = useCallback(() => {
    if (historyIndexRef.current > 0) void restoreSnapshot(historyIndexRef.current - 1)
  }, [restoreSnapshot])

  const redo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      void restoreSnapshot(historyIndexRef.current + 1)
    }
  }, [restoreSnapshot])

  useImperativeHandle(
    ref,
    () => ({
      exportMask: () => {
        const canvas = fabricCanvasRef.current
        const canvasElement = canvasElementRef.current
        if (!canvas || !canvasElement) throw new Error('蒙版画布尚未准备好')
        canvas.renderAll()
        return exportPaintedMask(canvasElement)
      },
      clear,
      undo,
      redo,
      canUndo: historyState.canUndo,
      canRedo: historyState.canRedo,
    }),
    [clear, historyState.canRedo, historyState.canUndo, redo, undo],
  )

  useEffect(() => {
    toolRef.current = tool
    brushSizeRef.current = brushSize
    smartSelectRef.current = smartSelectEnabled
    const canvas = fabricCanvasRef.current
    if (!canvas) return

    const brush = canvas.freeDrawingBrush ?? new PencilBrush(canvas)
    brush.width = brushSize
    brush.color = tool === 'brush' ? 'rgba(220, 38, 38, 0.5)' : 'rgba(0, 0, 0, 1)'
    canvas.freeDrawingBrush = brush
    canvas.isDrawingMode = !smartSelectEnabled
    canvas.contextTop.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
  }, [brushSize, smartSelectEnabled, tool])

  useEffect(() => {
    const canvasElement = canvasElementRef.current
    if (!canvasElement) return

    let disposed = false
    const canvas = new Canvas(canvasElement, {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      selection: false,
      isDrawingMode: true,
    })
    fabricCanvasRef.current = canvas

    const brush = new PencilBrush(canvas)
    brush.width = brushSizeRef.current
    brush.color = 'rgba(220, 38, 38, 0.5)'
    canvas.freeDrawingBrush = brush

    historyRef.current = [JSON.stringify(canvas.toJSON())]
    historyIndexRef.current = 0
    updateHistoryState(0, 1)

    canvas.on('path:created', ({ path }) => {
      path.set({
        selectable: false,
        evented: false,
        globalCompositeOperation: toolRef.current === 'eraser' ? 'destination-out' : 'source-over',
      })
      canvas.requestRenderAll()
      pushSnapshot()
    })

    canvas.on('mouse:down', async ({ e }) => {
      if (!smartSelectRef.current || selectingRef.current) return
      selectingRef.current = true
      try {
        const point = canvas.getScenePoint(e)
        const result = await smartSelect({
          imageUrl,
          point: { x: point.x, y: point.y },
          canvasSize: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
        })
        if (disposed) return
        const selection = await FabricImage.fromURL(result.maskDataUrl)
        selection.set({ left: 0, top: 0, opacity: 0.48, selectable: false, evented: false })
        canvas.add(selection)
        canvas.requestRenderAll()
        pushSnapshot()
      } finally {
        selectingRef.current = false
      }
    })

    return () => {
      disposed = true
      fabricCanvasRef.current = null
      void canvas.dispose()
    }
  }, [imageUrl, pushSnapshot, updateHistoryState])

  return (
    <div
      style={{
        position: 'relative',
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        maxWidth: '100%',
        background: 'var(--color-surface-2)',
        overflow: 'hidden',
        touchAction: 'none',
      }}
    >
      <img
        src={imageUrl}
        alt="待处理原图"
        draggable={false}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', userSelect: 'none' }}
      />
      <canvas ref={canvasElementRef} aria-label="蒙版涂抹画布" style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
    </div>
  )
})

export default MaskPaintCanvas
