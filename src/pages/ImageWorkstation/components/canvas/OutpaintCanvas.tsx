import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Canvas, FabricImage, Rect } from 'fabric'
import { computeOutpaintMask, type MaskExportResult } from '../../utils/maskExport'
import { useCanvasDisplay } from '../../utils/useCanvasDisplay'
import type { OutpaintOutputMode } from '@shared/outpaint'
import {
  freeOutpaintGeometry,
  modelSizeFromDisplay,
  OUTPAINT_VIEW_HEIGHT,
  OUTPAINT_VIEW_WIDTH,
  outpaintDisplayScale,
  presetOutpaintGeometry,
  type OutpaintModelGeometry,
} from '../../utils/outpaintGeometry'

interface OutpaintCanvasProps {
  imageUrl: string
  imageNaturalSize: { width: number; height: number }
  /** 选中平台预设时传入目标尺寸；为空时允许自由拖拽 */
  presetTargetSize?: { width: number; height: number }
  outputMode?: OutpaintOutputMode
  onTargetSizeChange?: (size: { width: number; height: number }) => void
}

export interface OutpaintCanvasHandle {
  exportMask: () => MaskExportResult
  getTargetSize: () => { width: number; height: number }
  getOriginOffset: () => { x: number; y: number }
  getSourceSize: () => { width: number; height: number }
}

const OutpaintCanvas = forwardRef<OutpaintCanvasHandle, OutpaintCanvasProps>(function OutpaintCanvas(
  { imageUrl, imageNaturalSize, presetTargetSize, outputMode = 'original', onTargetSizeChange },
  ref,
) {
  const { hostRef, display } = useCanvasDisplay()
  const canvasElementRef = useRef<HTMLCanvasElement>(null)
  const fabricCanvasRef = useRef<Canvas | null>(null)
  const frameRef = useRef<Rect | null>(null)
  const modelRef = useRef<OutpaintModelGeometry | null>(null)

  const getModel = () => {
    if (!modelRef.current) throw new Error('扩图画布尚未准备好')
    return modelRef.current
  }

  useImperativeHandle(
    ref,
    () => ({
      exportMask: () => {
        const model = getModel()
        return computeOutpaintMask(model.targetSize, model.originOffset, model.sourceSize)
      },
      getTargetSize: () => getModel().targetSize,
      getOriginOffset: () => getModel().originOffset,
      getSourceSize: () => getModel().sourceSize,
    }),
    [],
  )

  useEffect(() => {
    const canvasElement = canvasElementRef.current
    if (!canvasElement) return

    let disposed = false
    const canvas = new Canvas(canvasElement, {
      width: OUTPAINT_VIEW_WIDTH,
      height: OUTPAINT_VIEW_HEIGHT,
      selection: false,
      centeredScaling: true,
      preserveObjectStacking: true,
    })
    fabricCanvasRef.current = canvas

    const model = presetTargetSize
      ? presetOutpaintGeometry(
        imageNaturalSize.width,
        imageNaturalSize.height,
        presetTargetSize.width,
        presetTargetSize.height,
        outputMode,
      )
      : freeOutpaintGeometry(
        imageNaturalSize.width,
        imageNaturalSize.height,
        imageNaturalSize.width,
        imageNaturalSize.height,
      )
    modelRef.current = model
    onTargetSizeChange?.(model.targetSize)
    const displayScale = outpaintDisplayScale(model.targetSize.width, model.targetSize.height)

    const centerX = OUTPAINT_VIEW_WIDTH / 2
    const centerY = OUTPAINT_VIEW_HEIGHT / 2
    const frame = new Rect({
      left: centerX,
      top: centerY,
      originX: 'center',
      originY: 'center',
      width: model.targetSize.width * displayScale,
      height: model.targetSize.height * displayScale,
      fill: 'rgba(33, 207, 160, 0.12)',
      stroke: '#21cfa0',
      strokeWidth: 2,
      strokeDashArray: [8, 6],
      lockMovementX: true,
      lockMovementY: true,
      lockRotation: true,
      selectable: !presetTargetSize,
      evented: !presetTargetSize,
      transparentCorners: false,
      cornerColor: '#21cfa0',
      borderColor: '#21cfa0',
    })
    frame.setControlsVisibility({ mtr: false })
    frameRef.current = frame

    const applyFreeFrame = () => {
      if (presetTargetSize) return modelRef.current
      const size = modelSizeFromDisplay(frame.getScaledWidth(), frame.getScaledHeight(), displayScale)
      const next = freeOutpaintGeometry(
        imageNaturalSize.width,
        imageNaturalSize.height,
        size.width,
        size.height,
      )
      modelRef.current = next
      onTargetSizeChange?.(next.targetSize)
      return next
    }

    void FabricImage.fromURL(imageUrl).then((image) => {
      if (disposed) return
      const offsetX = (model.originOffset.x + model.sourceSize.width / 2 - model.targetSize.width / 2) * displayScale
      const offsetY = (model.originOffset.y + model.sourceSize.height / 2 - model.targetSize.height / 2) * displayScale
      image.set({
        left: centerX + offsetX,
        top: centerY + offsetY,
        originX: 'center',
        originY: 'center',
        scaleX: (model.sourceSize.width * displayScale) / imageNaturalSize.width,
        scaleY: (model.sourceSize.height * displayScale) / imageNaturalSize.height,
        selectable: false,
        evented: false,
      })
      canvas.add(image, frame)
      if (!presetTargetSize) canvas.setActiveObject(frame)
      canvas.requestRenderAll()
    })

    canvas.on('object:scaling', ({ target }) => {
      if (target !== frame || presetTargetSize) return
      const minimumWidth = imageNaturalSize.width * displayScale
      const minimumHeight = imageNaturalSize.height * displayScale
      if (frame.getScaledWidth() < minimumWidth) frame.scaleX = minimumWidth / frame.width
      if (frame.getScaledHeight() < minimumHeight) frame.scaleY = minimumHeight / frame.height
      applyFreeFrame()
      frame.setCoords()
    })

    canvas.on('object:modified', ({ target }) => {
      if (target !== frame || presetTargetSize) return
      const next = applyFreeFrame()
      if (!next) return
      frame.set({
        width: next.targetSize.width * displayScale,
        height: next.targetSize.height * displayScale,
        scaleX: 1,
        scaleY: 1,
      })
      frame.setCoords()
    })

    return () => {
      disposed = true
      frameRef.current = null
      modelRef.current = null
      fabricCanvasRef.current = null
      void canvas.dispose()
    }
  }, [imageNaturalSize, imageUrl, presetTargetSize, outputMode, onTargetSizeChange])

  return (
    <div ref={hostRef} className="workstation-paint-host">
      <div className="workstation-paint-frame" style={{ width: display.width, height: display.height }}>
        <div
          className="workstation-paint-stage"
          style={{
            width: OUTPAINT_VIEW_WIDTH,
            height: OUTPAINT_VIEW_HEIGHT,
            transform: `scale(${display.scale})`,
          }}
        >
          <canvas ref={canvasElementRef} aria-label="扩图边界画布" style={{ touchAction: 'none' }} />
        </div>
      </div>
    </div>
  )
})

export default OutpaintCanvas
