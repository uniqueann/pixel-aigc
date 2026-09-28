import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { message } from 'antd'
import { Canvas, FabricImage, PencilBrush } from 'fabric'
import { containRect } from '@shared/erase'
import { invertContainedAlpha, MASK_PAINT_CSS, opaqueCount, sourcePoint, tintOverlayAsBrush } from '@shared/smart-select'
import { requestSmartSelect, SmartSelectRequestError, smartSelectErrorMessage, storeSmartSelectSession, type SmartSelectResult } from '@/services/api/smartSelect'
import { WORKSTATION_CANVAS_HEIGHT, WORKSTATION_CANVAS_WIDTH } from '../../utils/canvasDisplay'
import { exportEraseMask, exportPaintedMask, overlayHasPaint, type MaskExportResult } from '../../utils/maskExport'
import { useCanvasDisplay } from '../../utils/useCanvasDisplay'
import type { PaintTool } from './BrushToolbar'

const CANVAS_WIDTH = WORKSTATION_CANVAS_WIDTH
const CANVAS_HEIGHT = WORKSTATION_CANVAS_HEIGHT
const MAX_HISTORY = 20
const SMART_SELECT_TOAST_KEY = 'workstation-smart-select'

interface MaskPaintCanvasProps {
  imageUrl: string
  imageNaturalSize?: { width: number; height: number }
  brushSize: number
  tool: PaintTool
  smartSelectEnabled: boolean
  refineMode?: boolean
  onHistoryChange?: (state: { canUndo: boolean; canRedo: boolean }) => void
  onMaskChange?: (hasPaint: boolean) => void
}

export interface MaskPaintCanvasHandle {
  exportMask: () => MaskExportResult
  exportRefineMarks: () => ImageData
  clear: () => void
  undo: () => void
  redo: () => void
  invertSelection: () => Promise<void>
  canUndo: boolean
  canRedo: boolean
}

function paintSurface(canvas: Canvas | null, fallback: HTMLCanvasElement | null) {
  return (canvas as Canvas & { lowerCanvasEl?: HTMLCanvasElement }).lowerCanvasEl ?? fallback
}

function flushOverlayHasPaint(canvas: Canvas | null, fallback: HTMLCanvasElement | null) {
  if (!canvas) return false
  canvas.renderAll()
  return overlayHasPaint(paintSurface(canvas, fallback))
}

const MaskPaintCanvas = forwardRef<MaskPaintCanvasHandle, MaskPaintCanvasProps>(function MaskPaintCanvas(
  { imageUrl, imageNaturalSize, brushSize, tool, smartSelectEnabled, refineMode = false, onHistoryChange, onMaskChange },
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
  const naturalRef = useRef(imageNaturalSize)
  const sessionRef = useRef<{ imageUrl: string; session: SmartSelectResult['session'] } | null>(null)
  naturalRef.current = imageNaturalSize
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
    onMaskChange?.(flushOverlayHasPaint(canvas, canvasElementRef.current))
  }, [onMaskChange, updateHistoryState])

  const restoreSnapshot = useCallback(
    async (nextIndex: number) => {
      const canvas = fabricCanvasRef.current
      const snapshot = historyRef.current[nextIndex]
      if (!canvas || !snapshot) return

      restoringRef.current = true
      await canvas.loadFromJSON(snapshot)
      canvas.getObjects().forEach((object) => object.set({ selectable: false, evented: false }))
      historyIndexRef.current = nextIndex
      restoringRef.current = false
      updateHistoryState(nextIndex, historyRef.current.length)
      onMaskChange?.(flushOverlayHasPaint(canvas, canvasElementRef.current))
    },
    [onMaskChange, updateHistoryState],
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

  const paintSelection = useCallback(async (result: SmartSelectResult, natural: { width: number; height: number }) => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return
    const rect = containRect(natural.width, natural.height, CANVAS_WIDTH, CANVAS_HEIGHT)
    const source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('读取选区蒙版失败'))
      image.src = result.maskDataUrl
    })
    const stamp = document.createElement('canvas')
    stamp.width = result.width
    stamp.height = result.height
    const stampContext = stamp.getContext('2d')
    if (!stampContext) throw new Error('当前浏览器不支持画布蒙版导出')
    stampContext.drawImage(source, 0, 0, result.width, result.height)
    const pixels = stampContext.getImageData(0, 0, result.width, result.height)
    tintOverlayAsBrush(pixels.data)
    stampContext.putImageData(pixels, 0, 0)
    const selection = await FabricImage.fromURL(stamp.toDataURL('image/png'))
    selection.set({
      left: rect.x,
      top: rect.y,
      originX: 'left',
      originY: 'top',
      scaleX: rect.width / result.width,
      scaleY: rect.height / result.height,
      selectable: false,
      evented: false,
      objectCaching: false,
    })
    canvas.add(selection)
    canvas.renderAll()
  }, [])

  const invertSelection = useCallback(async () => {
    const canvas = fabricCanvasRef.current
    const natural = naturalRef.current
    if (!canvas || !natural?.width || !natural.height) throw new Error('蒙版画布尚未准备好')
    canvas.renderAll()
    const surface = paintSurface(canvas, canvasElementRef.current)
    const context = surface?.getContext('2d')
    if (!surface || !context) throw new Error('蒙版画布尚未准备好')
    const pixels = context.getImageData(0, 0, surface.width, surface.height)
    const rect = containRect(natural.width, natural.height, surface.width, surface.height)
    if (opaqueCount(pixels.data, surface.width, surface.height, rect) === 0) {
      throw new Error('请先创建选区后再反选')
    }
    const inverted = new Uint8ClampedArray(pixels.data)
    invertContainedAlpha(inverted, surface.width, surface.height, rect)
    const snapshot = document.createElement('canvas')
    snapshot.width = surface.width
    snapshot.height = surface.height
    const snapshotContext = snapshot.getContext('2d')
    if (!snapshotContext) throw new Error('当前浏览器不支持画布蒙版导出')
    snapshotContext.putImageData(new ImageData(inverted, surface.width, surface.height), 0, 0)
    canvas.clear()
    const image = await FabricImage.fromURL(snapshot.toDataURL('image/png'))
    image.set({ left: 0, top: 0, selectable: false, evented: false, objectCaching: false })
    canvas.add(image)
    canvas.renderAll()
    pushSnapshot()
  }, [pushSnapshot])

  useImperativeHandle(
    ref,
    () => ({
      exportMask: () => {
        const canvas = fabricCanvasRef.current
        if (!canvas) throw new Error('蒙版画布尚未准备好')
        canvas.renderAll()
        const surface = paintSurface(canvas, canvasElementRef.current)
        if (!surface) throw new Error('蒙版画布尚未准备好')
        if (imageNaturalSize && imageNaturalSize.width > 0 && imageNaturalSize.height > 0) {
          return exportEraseMask(surface, imageNaturalSize)
        }
        return exportPaintedMask(surface)
      },
      exportRefineMarks: () => {
        const canvas = fabricCanvasRef.current
        if (!canvas) throw new Error('蒙版画布尚未准备好')
        canvas.renderAll()
        const surface = paintSurface(canvas, canvasElementRef.current)
        if (!surface) throw new Error('蒙版画布尚未准备好')
        const context = surface.getContext('2d')
        if (!context) throw new Error('当前浏览器不支持画布蒙版导出')
        return context.getImageData(0, 0, surface.width, surface.height)
      },
      clear,
      undo,
      redo,
      invertSelection,
      canUndo: historyState.canUndo,
      canRedo: historyState.canRedo,
    }),
    [clear, historyState.canRedo, historyState.canUndo, imageNaturalSize, invertSelection, redo, undo],
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
      : (tool === 'brush' ? MASK_PAINT_CSS : 'rgba(0, 0, 0, 1)')
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
      enableRetinaScaling: false,
    })
    fabricCanvasRef.current = canvas

    const brush = new PencilBrush(canvas)
    brush.width = brushSizeRef.current
    brush.color = refineModeRef.current
      ? (toolRef.current === 'brush' ? 'rgba(255, 0, 0, 0.9)' : 'rgba(0, 80, 255, 0.9)')
      : MASK_PAINT_CSS
    canvas.freeDrawingBrush = brush
    canvas.contextTop.globalCompositeOperation = !refineModeRef.current && toolRef.current === 'eraser' ? 'destination-out' : 'source-over'

    historyRef.current = [JSON.stringify(canvas.toJSON())]
    historyIndexRef.current = 0
    sessionRef.current = null
    updateHistoryState(0, 1)
    onMaskChange?.(false)

    canvas.on('path:created', ({ path }) => {
      path.set({
        selectable: false,
        evented: false,
        globalCompositeOperation: refineModeRef.current || toolRef.current !== 'eraser' ? 'source-over' : 'destination-out',
      })
      canvas.renderAll()
      pushSnapshot()
    })

    canvas.on('mouse:down', async ({ e }) => {
      if (!smartSelectRef.current || selectingRef.current || refineModeRef.current) return
      const natural = naturalRef.current
      if (!natural?.width || !natural.height) {
        message.warning('无法读取原图尺寸')
        return
      }
      const scene = canvas.getScenePoint(e)
      const point = sourcePoint(scene.x, scene.y, natural.width, natural.height, CANVAS_WIDTH, CANVAS_HEIGHT)
      if (!point) {
        message.warning('请点在图片上')
        return
      }
      selectingRef.current = true
      message.loading({ content: '正在识别商品轮廓…', duration: 0, key: SMART_SELECT_TOAST_KEY })
      try {
        const cached = sessionRef.current?.imageUrl === imageUrl ? sessionRef.current.session : null
        const result = await requestSmartSelect({
          imageUrl,
          naturalSize: natural,
          point,
          session: cached,
        })
        if (disposed) {
          message.destroy(SMART_SELECT_TOAST_KEY)
          return
        }
        sessionRef.current = { imageUrl, session: result.session }
        storeSmartSelectSession(imageUrl, result.session)
        await paintSelection(result, natural)
        if (disposed) {
          message.destroy(SMART_SELECT_TOAST_KEY)
          return
        }
        pushSnapshot()
        message.destroy(SMART_SELECT_TOAST_KEY)
      } catch (error) {
        if (error instanceof SmartSelectRequestError && error.session) {
          sessionRef.current = { imageUrl, session: error.session }
          storeSmartSelectSession(imageUrl, error.session)
        }
        if (!disposed) {
          message.error({ content: smartSelectErrorMessage(error), key: SMART_SELECT_TOAST_KEY, duration: 5 })
        } else {
          message.destroy(SMART_SELECT_TOAST_KEY)
        }
      } finally {
        selectingRef.current = false
      }
    })

    return () => {
      disposed = true
      fabricCanvasRef.current = null
      void canvas.dispose()
    }
  }, [imageUrl, onMaskChange, paintSelection, pushSnapshot, updateHistoryState])

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
