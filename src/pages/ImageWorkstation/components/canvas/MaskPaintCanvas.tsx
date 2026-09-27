import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Canvas, FabricImage, PencilBrush } from 'fabric'
import { smartSelect } from '@/services/api/smartSelect'
import { WORKSTATION_CANVAS_HEIGHT, WORKSTATION_CANVAS_WIDTH } from '../../utils/canvasDisplay'
import { exportEraseMask, exportPaintedMask, type MaskExportResult } from '../../utils/maskExport'
import { useCanvasDisplay } from '../../utils/useCanvasDisplay'
import type { PaintTool } from './BrushToolbar'

const CANVAS_WIDTH = WORKSTATION_CANVAS_WIDTH
const CANVAS_HEIGHT = WORKSTATION_CANVAS_HEIGHT
const MAX_HISTORY = 20

interface MaskPaintCanvasProps {
  imageUrl: string
  imageNaturalSize?: { width: number; height: number }
  brushSize: number
  tool: PaintTool
  smartSelectEnabled: boolean
  refineMode?: boolean
  onHistoryChange?: (state: { canUndo: boolean; canRedo: boolean }) => void
}

export interface MaskPaintCanvasHandle {
  exportMask: () => MaskExportResult
  exportRefineMarks: () => ImageData
  clear: () => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

const MaskPaintCanvas = forwardRef<MaskPaintCanvasHandle, MaskPaintCanvasProps>(function MaskPaintCanvas(
  { imageUrl, imageNaturalSize, brushSize, tool, smartSelectEnabled, refineMode = false, onHistoryChange },
  ref,
) {
  const { hostRef, display } = useCanvasDisplay()
  const canvasElementRef = useRef<HTMLCanvasElement>(null)
  const fabricCanvasRef = useRef<Canvas | null>(null)
  const historyRef = useRef<string[]>([])
  const historyIndexRef = useRef(-1)
  const toolRef = useRef(tool)
  const refineModeRef = useRef(refineMode)
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
        if (imageNaturalSize && imageNaturalSize.width > 0 && imageNaturalSize.height > 0) {
          return exportEraseMask(canvasElement, imageNaturalSize)
        }
        return exportPaintedMask(canvasElement)
      },
      exportRefineMarks: () => {
        const canvas = fabricCanvasRef.current
        const canvasElement = canvasElementRef.current
        if (!canvas || !canvasElement) throw new Error('蒙版画布尚未准备好')
        canvas.renderAll()
        const context = canvasElement.getContext('2d')
        if (!context) throw new Error('当前浏览器不支持画布蒙版导出')
        return context.getImageData(0, 0, canvasElement.width, canvasElement.height)
      },
      clear,
      undo,
      redo,
      canUndo: historyState.canUndo,
      canRedo: historyState.canRedo,
    }),
    [clear, historyState.canRedo, historyState.canUndo, imageNaturalSize, redo, undo],
  )

  useEffect(() => {
    toolRef.current = tool
    brushSizeRef.current = brushSize
    smartSelectRef.current = smartSelectEnabled
    refineModeRef.current = refineMode
    const canvas = fabricCanvasRef.current
    if (!canvas) return

    const brush = canvas.freeDrawingBrush ?? new PencilBrush(canvas)
    brush.width = brushSize
    brush.color = refineMode
      ? (tool === 'brush' ? 'rgba(255, 0, 0, 0.9)' : 'rgba(0, 80, 255, 0.9)')
      : (tool === 'brush' ? 'rgba(220, 38, 38, 0.5)' : 'rgba(0, 0, 0, 1)')
    canvas.freeDrawingBrush = brush
    canvas.isDrawingMode = !smartSelectEnabled
    canvas.contextTop.globalCompositeOperation = !refineMode && tool === 'eraser' ? 'destination-out' : 'source-over'
  }, [brushSize, refineMode, smartSelectEnabled, tool])

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
    brush.color = refineModeRef.current
      ? (toolRef.current === 'brush' ? 'rgba(255, 0, 0, 0.9)' : 'rgba(0, 80, 255, 0.9)')
      : 'rgba(220, 38, 38, 0.5)'
    canvas.freeDrawingBrush = brush
    canvas.contextTop.globalCompositeOperation = !refineModeRef.current && toolRef.current === 'eraser' ? 'destination-out' : 'source-over'

    historyRef.current = [JSON.stringify(canvas.toJSON())]
    historyIndexRef.current = 0
    updateHistoryState(0, 1)

    canvas.on('path:created', ({ path }) => {
      path.set({
        selectable: false,
        evented: false,
        globalCompositeOperation: refineModeRef.current || toolRef.current !== 'eraser' ? 'source-over' : 'destination-out',
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
    <div ref={hostRef} className="workstation-paint-host">
      <div className="workstation-paint-frame" style={{ width: display.width, height: display.height }}>
        <div
          className="workstation-paint-stage"
          style={{
            width: CANVAS_WIDTH,
            height: CANVAS_HEIGHT,
            transform: `scale(${display.scale})`,
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
      </div>
    </div>
  )
})

export default MaskPaintCanvas
