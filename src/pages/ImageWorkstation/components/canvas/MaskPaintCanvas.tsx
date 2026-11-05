import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { message } from 'antd'
import { Canvas, Circle, FabricImage, Line, PencilBrush, Rect } from 'fabric'
import { containRect } from '@shared/erase'
import { invertContainedAlpha, MASK_PAINT_CSS, opaqueCount, sourcePoint, tintOverlayAsBrush } from '@shared/smart-select'
import { applySmartSelectLookup, requestSmartSelect, SmartSelectRequestError, smartSelectErrorMessage, storeSmartSelectSession, type SmartSelectResult } from '@/services/api/smartSelect'
import { WORKSTATION_CANVAS_HEIGHT, WORKSTATION_CANVAS_WIDTH } from '../../utils/canvasDisplay'
import { exportEraseMask, exportPaintedMask, overlayHasPaint, type MaskExportResult } from '../../utils/maskExport'
import { useCanvasDisplay } from '../../utils/useCanvasDisplay'
import { brushCursorPlacement } from '../../utils/brushCursor'
import type { PaintTool } from './BrushToolbar'

const CANVAS_WIDTH = WORKSTATION_CANVAS_WIDTH
const CANVAS_HEIGHT = WORKSTATION_CANVAS_HEIGHT
const MAX_HISTORY = 20
const SMART_SELECT_TOAST_KEY = 'workstation-smart-select'
/** 键盘光标每次移动的逻辑像素；按住 Shift 加速。 */
const KEYBOARD_STEP = 4
const KEYBOARD_STEP_FAST = 16
const MIN_BRUSH_SIZE = 4
const MAX_BRUSH_SIZE = 80

interface MaskPaintCanvasProps {
  imageUrl: string
  imageObjectKey?: string
  imageNaturalSize?: { width: number; height: number }
  brushSize: number
  tool: PaintTool
  smartSelectEnabled: boolean
  refineMode?: boolean
  /** 生成中或读取结果时锁定涂抹。 */
  disabled?: boolean
  onHistoryChange?: (state: { canUndo: boolean; canRedo: boolean }) => void
  onMaskChange?: (hasPaint: boolean) => void
  /** 键盘 B/E 切换画笔与橡皮擦时同步工具条状态。 */
  onToolChange?: (tool: PaintTool) => void
  /** 键盘 [ / ] 调整笔刷大小时同步工具条状态。 */
  onBrushSizeChange?: (size: number) => void
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
  { imageUrl, imageObjectKey, imageNaturalSize, brushSize, tool, smartSelectEnabled, refineMode = false, disabled = false, onHistoryChange, onMaskChange, onToolChange, onBrushSizeChange },
  ref,
) {
  const { hostRef, display } = useCanvasDisplay()
  const objectKeyRef = useRef(imageObjectKey)
  objectKeyRef.current = imageObjectKey
  const canvasElementRef = useRef<HTMLCanvasElement>(null)
  const fabricCanvasRef = useRef<Canvas | null>(null)
  const historyRef = useRef<string[]>([])
  const historyIndexRef = useRef(-1)
  const toolRef = useRef(tool)
  const refineModeRef = useRef(refineMode)
  const brushSizeRef = useRef(brushSize)
  const smartSelectRef = useRef(smartSelectEnabled)
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled
  const restoringRef = useRef(false)
  const selectingRef = useRef(false)
  const naturalRef = useRef(imageNaturalSize)
  const sessionRef = useRef<{ imageUrl: string; session: SmartSelectResult['session'] } | null>(null)
  naturalRef.current = imageNaturalSize
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false })
  const keyboardHelpId = useId()
  const [keyboardCursor, setKeyboardCursor] = useState<{ x: number; y: number } | null>(null)
  const cursorRef = useRef<{ x: number; y: number } | null>(null)
  const spaceHeldRef = useRef(false)
  const strokeDirtyRef = useRef(false)
  const brushCursorRef = useRef<HTMLDivElement>(null)

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

  /** 键盘涂抹限定在图片实际内容区，避免在 contain 黑边上画出无效蒙版。 */
  const paintRect = useCallback(() => {
    const natural = naturalRef.current
    if (natural?.width && natural.height) {
      return containRect(natural.width, natural.height, CANVAS_WIDTH, CANVAS_HEIGHT)
    }
    return { x: 0, y: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT }
  }, [])

  /** 指针涂抹同样裁到图片内容区；upperCanvas 的实时笔迹也一起裁，避免图外短暂可见。 */
  const applyPaintClip = useCallback((canvas: Canvas) => {
    const rect = paintRect()
    canvas.clipPath = new Rect({
      left: rect.x,
      top: rect.y,
      width: rect.width,
      height: rect.height,
      absolutePositioned: true,
      selectable: false,
      evented: false,
    })
    const upper = (canvas as Canvas & { upperCanvasEl?: HTMLCanvasElement }).upperCanvasEl
    if (upper) {
      upper.style.clipPath = `inset(${rect.y}px ${CANVAS_WIDTH - rect.x - rect.width}px ${CANVAS_HEIGHT - rect.y - rect.height}px ${rect.x}px)`
    }
    canvas.requestRenderAll()
  }, [paintRect])

  const hidePointerCursor = useCallback(() => {
    if (brushCursorRef.current) brushCursorRef.current.style.display = 'none'
  }, [])

  const updatePointerCursor = useCallback((scene: { x: number; y: number } | null) => {
    const element = brushCursorRef.current
    if (!element) return
    if (!scene || disabledRef.current || cursorRef.current) {
      element.style.display = 'none'
      return
    }
    const placement = brushCursorPlacement(scene, paintRect(), brushSizeRef.current)
    element.style.display = 'block'
    element.style.left = `${placement.left}px`
    element.style.top = `${placement.top}px`
    element.style.width = `${placement.size}px`
    element.style.height = `${placement.size}px`
    element.classList.toggle('is-outside', placement.outside)
    element.classList.toggle('is-eraser', !refineModeRef.current && toolRef.current === 'eraser')
  }, [paintRect])

  const keyboardPaintStyle = useCallback(() => {
    const refine = refineModeRef.current
    const activeTool = toolRef.current
    const color = refine
      ? (activeTool === 'brush' ? 'rgba(255, 0, 0, 0.9)' : 'rgba(0, 80, 255, 0.9)')
      : (activeTool === 'brush' ? MASK_PAINT_CSS : 'rgba(0, 0, 0, 1)')
    const eraser = !refine && activeTool === 'eraser'
    const globalCompositeOperation: 'destination-out' | 'source-over' = eraser ? 'destination-out' : 'source-over'
    return { color, globalCompositeOperation, eraser }
  }, [])

  const paintKeyboardDab = useCallback((point: { x: number; y: number }) => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return
    const { color, globalCompositeOperation, eraser } = keyboardPaintStyle()
    const dab = new Circle({
      left: point.x,
      top: point.y,
      originX: 'center',
      originY: 'center',
      // 橡皮擦略放大 1px，覆盖画笔圆形的抗锯齿边缘，避免留下红圈。
      radius: Math.max(1, brushSizeRef.current / 2 + (eraser ? 1 : 0)),
      fill: color,
      selectable: false,
      evented: false,
      objectCaching: false,
      globalCompositeOperation,
    })
    canvas.add(dab)
    canvas.renderAll()
    strokeDirtyRef.current = true
    onMaskChange?.(flushOverlayHasPaint(canvas, canvasElementRef.current))
  }, [keyboardPaintStyle, onMaskChange])

  const paintKeyboardSegment = useCallback((from: { x: number; y: number }, to: { x: number; y: number }) => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return
    const { color, globalCompositeOperation, eraser } = keyboardPaintStyle()
    const segment = new Line([from.x, from.y, to.x, to.y], {
      stroke: color,
      strokeWidth: brushSizeRef.current + (eraser ? 2 : 0),
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
      selectable: false,
      evented: false,
      objectCaching: false,
      globalCompositeOperation,
    })
    canvas.add(segment)
    canvas.renderAll()
    strokeDirtyRef.current = true
    onMaskChange?.(flushOverlayHasPaint(canvas, canvasElementRef.current))
  }, [keyboardPaintStyle, onMaskChange])

  const activateKeyboardCursor = useCallback(() => {
    if (cursorRef.current) return
    const rect = paintRect()
    const start = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    cursorRef.current = start
    setKeyboardCursor(start)
  }, [paintRect])

  const moveKeyboardCursor = useCallback((dx: number, dy: number) => {
    const rect = paintRect()
    const current = cursorRef.current ?? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    const next = {
      x: Math.min(rect.x + rect.width, Math.max(rect.x, current.x + dx)),
      y: Math.min(rect.y + rect.height, Math.max(rect.y, current.y + dy)),
    }
    if (spaceHeldRef.current && (next.x !== current.x || next.y !== current.y)) {
      paintKeyboardSegment(current, next)
    }
    cursorRef.current = next
    setKeyboardCursor(next)
  }, [paintKeyboardSegment, paintRect])

  const deactivateKeyboardCursor = useCallback(() => {
    cursorRef.current = null
    spaceHeldRef.current = false
    setKeyboardCursor(null)
  }, [])

  useEffect(() => {
    if (!disabled) return
    deactivateKeyboardCursor()
    hidePointerCursor()
  }, [deactivateKeyboardCursor, disabled, hidePointerCursor])

  const restoreSnapshot = useCallback(
    async (nextIndex: number) => {
      const canvas = fabricCanvasRef.current
      const snapshot = historyRef.current[nextIndex]
      if (!canvas || !snapshot) return

      restoringRef.current = true
      await canvas.loadFromJSON(snapshot)
      canvas.getObjects().forEach((object) => object.set({ selectable: false, evented: false }))
      applyPaintClip(canvas)
      historyIndexRef.current = nextIndex
      restoringRef.current = false
      updateHistoryState(nextIndex, historyRef.current.length)
      onMaskChange?.(flushOverlayHasPaint(canvas, canvasElementRef.current))
    },
    [applyPaintClip, onMaskChange, updateHistoryState],
  )

  const clear = useCallback(() => {
    const canvas = fabricCanvasRef.current
    if (!canvas || disabledRef.current) return
    canvas.clear()
    applyPaintClip(canvas)
    canvas.requestRenderAll()
    pushSnapshot()
  }, [applyPaintClip, pushSnapshot])

  const undo = useCallback(() => {
    if (disabledRef.current) return
    if (historyIndexRef.current > 0) void restoreSnapshot(historyIndexRef.current - 1)
  }, [restoreSnapshot])

  const redo = useCallback(() => {
    if (disabledRef.current) return
    if (historyIndexRef.current < historyRef.current.length - 1) {
      void restoreSnapshot(historyIndexRef.current + 1)
    }
  }, [restoreSnapshot])

  const handleKeyboardKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      hostRef.current?.blur()
      return
    }
    if (disabledRef.current) return
    if (event.key === 'b' || event.key === 'B') {
      event.preventDefault()
      onToolChange?.('brush')
      return
    }
    if (event.key === 'e' || event.key === 'E') {
      event.preventDefault()
      onToolChange?.('eraser')
      return
    }
    if (event.key === '[' || event.code === 'BracketLeft') {
      event.preventDefault()
      onBrushSizeChange?.(Math.max(MIN_BRUSH_SIZE, brushSizeRef.current - KEYBOARD_STEP))
      return
    }
    if (event.key === ']' || event.code === 'BracketRight') {
      event.preventDefault()
      onBrushSizeChange?.(Math.min(MAX_BRUSH_SIZE, brushSizeRef.current + KEYBOARD_STEP))
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
      return
    }
    if (event.key === ' ') {
      event.preventDefault()
      activateKeyboardCursor()
      if (!event.repeat) {
        spaceHeldRef.current = true
        const point = cursorRef.current
        if (point) paintKeyboardDab(point)
      }
      return
    }
    const step = event.shiftKey ? KEYBOARD_STEP_FAST : KEYBOARD_STEP
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const direction = directions[event.key]
    if (!direction) return
    event.preventDefault()
    activateKeyboardCursor()
    moveKeyboardCursor(direction[0], direction[1])
  }, [activateKeyboardCursor, hostRef, moveKeyboardCursor, onBrushSizeChange, onToolChange, paintKeyboardDab, redo, undo])

  const handleKeyboardKeyUp = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== ' ') return
    event.preventDefault()
    spaceHeldRef.current = false
    if (disabledRef.current) return
    if (strokeDirtyRef.current) {
      strokeDirtyRef.current = false
      pushSnapshot()
    }
  }, [pushSnapshot])

  const handleKeyboardFocus = useCallback(() => {
    if (!disabledRef.current && hostRef.current?.matches(':focus-visible')) activateKeyboardCursor()
  }, [activateKeyboardCursor, hostRef])

  const handleKeyboardBlur = useCallback(() => {
    if (strokeDirtyRef.current) {
      strokeDirtyRef.current = false
      pushSnapshot()
    }
    deactivateKeyboardCursor()
  }, [deactivateKeyboardCursor, pushSnapshot])

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
    if (disabledRef.current) return
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
    applyPaintClip(canvas)
    const image = await FabricImage.fromURL(snapshot.toDataURL('image/png'))
    image.set({ left: 0, top: 0, selectable: false, evented: false, objectCaching: false })
    canvas.add(image)
    canvas.renderAll()
    pushSnapshot()
  }, [applyPaintClip, pushSnapshot])

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
    canvas.isDrawingMode = !disabled && !smartSelectEnabled
    canvas.contextTop.globalCompositeOperation = !refineMode && tool === 'eraser' ? 'destination-out' : 'source-over'
    if (disabled) hidePointerCursor()
  }, [brushSize, disabled, hidePointerCursor, refineMode, smartSelectEnabled, tool])

  useEffect(() => {
    const canvas = fabricCanvasRef.current
    if (canvas) applyPaintClip(canvas)
  }, [applyPaintClip, imageNaturalSize?.width, imageNaturalSize?.height])

  // clipPath 同时裁掉了 upperCanvas 的命中区域，图片外收不到 Fabric 的 mouse:move；
  // 用 host 的原生指针事件补齐图外虚线光标，并在离开画布时隐藏。
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const handleMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      const frame = host.querySelector<HTMLElement>('.workstation-paint-frame')
      if (!frame || !display.scale) return
      const rect = frame.getBoundingClientRect()
      updatePointerCursor({
        x: (event.clientX - rect.left) / display.scale,
        y: (event.clientY - rect.top) / display.scale,
      })
    }
    host.addEventListener('pointermove', handleMove)
    host.addEventListener('pointerleave', hidePointerCursor)
    return () => {
      host.removeEventListener('pointermove', handleMove)
      host.removeEventListener('pointerleave', hidePointerCursor)
    }
  }, [display.scale, hidePointerCursor, hostRef, updatePointerCursor])

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
    applyPaintClip(canvas)

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
      if (disabledRef.current || !smartSelectRef.current || selectingRef.current || refineModeRef.current) return
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
        const lookup = await requestSmartSelect({
          imageUrl,
          objectKey: objectKeyRef.current,
          naturalSize: natural,
          point,
          session: cached,
        })
        if (disposed) {
          message.destroy(SMART_SELECT_TOAST_KEY)
          return
        }
        const decision = applySmartSelectLookup(lookup, cached)
        if (decision.session) {
          sessionRef.current = { imageUrl, session: decision.session }
          storeSmartSelectSession(imageUrl, decision.session)
        }
        if (!decision.paint) {
          message.error({ content: decision.toast ?? smartSelectErrorMessage(lookup), key: SMART_SELECT_TOAST_KEY, duration: 5 })
          return
        }
        await paintSelection(decision.paint, natural)
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
  }, [applyPaintClip, imageUrl, onMaskChange, paintSelection, pushSnapshot, updateHistoryState])

  return (
    <div
      ref={hostRef}
      className="workstation-paint-host"
      tabIndex={0}
      role="application"
      aria-label="蒙版涂抹画布"
      aria-describedby={keyboardHelpId}
      onKeyDown={handleKeyboardKeyDown}
      onKeyUp={handleKeyboardKeyUp}
      onFocus={handleKeyboardFocus}
      onBlur={handleKeyboardBlur}
    >
      <p id={keyboardHelpId} className="sr-only">
        使用方向键移动笔刷，按住空格涂抹；B 切换画笔，E 切换橡皮擦；左右方括号调整笔刷大小；Ctrl 或 Command 加 Z 撤销，加 Shift 加 Z 重做；Esc 退出画布。
      </p>
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
          <canvas ref={canvasElementRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          <div ref={brushCursorRef} className="workstation-paint-brush-cursor" aria-hidden="true" />
          {keyboardCursor ? (
            <div
              className="workstation-paint-keyboard-cursor"
              aria-hidden="true"
              style={{
                left: keyboardCursor.x,
                top: keyboardCursor.y,
                width: brushSize,
                height: brushSize,
              }}
            />
          ) : null}
        </div>
        {keyboardCursor ? (
          <div className="workstation-paint-keyboard-hint">
            方向键移动 · 空格涂抹 · B/E 切换 · [ ] 调笔刷 · Esc 退出
          </div>
        ) : null}
        {disabled ? (
          <div className="workstation-paint-disabled-hint" role="status">正在生成，暂不可涂抹</div>
        ) : null}
      </div>
    </div>
  )
})

export default MaskPaintCanvas
