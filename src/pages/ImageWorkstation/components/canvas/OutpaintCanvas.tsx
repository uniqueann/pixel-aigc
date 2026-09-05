import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Canvas, FabricImage, Rect } from 'fabric'
import { computeOutpaintMask, type MaskExportResult } from '../../utils/maskExport'

const CANVAS_WIDTH = 640
const CANVAS_HEIGHT = 420
const SCENE_PADDING = 48

interface OutpaintCanvasProps {
  imageUrl: string
  imageNaturalSize: { width: number; height: number }
  /** 选中平台预设时传入目标尺寸；为空时允许自由拖拽 */
  presetTargetSize?: { width: number; height: number }
}

export interface OutpaintCanvasHandle {
  exportMask: () => MaskExportResult
  getTargetSize: () => { width: number; height: number }
  getOriginOffset: () => { x: number; y: number }
}

const OutpaintCanvas = forwardRef<OutpaintCanvasHandle, OutpaintCanvasProps>(function OutpaintCanvas(
  { imageUrl, imageNaturalSize, presetTargetSize },
  ref,
) {
  const canvasElementRef = useRef<HTMLCanvasElement>(null)
  const fabricCanvasRef = useRef<Canvas | null>(null)
  const frameRef = useRef<Rect | null>(null)
  const imageRef = useRef<FabricImage | null>(null)
  const displayScaleRef = useRef(1)

  const getGeometry = () => {
    const frame = frameRef.current
    const image = imageRef.current
    const displayScale = displayScaleRef.current
    if (!frame || !image || !displayScale) throw new Error('扩图画布尚未准备好')

    const frameBounds = frame.getBoundingRect()
    const imageBounds = image.getBoundingRect()
    return {
      targetSize: {
        width: Math.round(frameBounds.width / displayScale),
        height: Math.round(frameBounds.height / displayScale),
      },
      originOffset: {
        x: Math.max(0, Math.round((imageBounds.left - frameBounds.left) / displayScale)),
        y: Math.max(0, Math.round((imageBounds.top - frameBounds.top) / displayScale)),
      },
    }
  }

  useImperativeHandle(
    ref,
    () => ({
      exportMask: () => {
        const geometry = getGeometry()
        return computeOutpaintMask(geometry.targetSize, geometry.originOffset, imageNaturalSize)
      },
      getTargetSize: () => getGeometry().targetSize,
      getOriginOffset: () => getGeometry().originOffset,
    }),
    [imageNaturalSize],
  )

  useEffect(() => {
    const canvasElement = canvasElementRef.current
    if (!canvasElement) return

    let disposed = false
    const canvas = new Canvas(canvasElement, {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      selection: false,
      centeredScaling: true,
      preserveObjectStacking: true,
    })
    fabricCanvasRef.current = canvas

    const targetNaturalSize = presetTargetSize
      ? {
          width: Math.max(presetTargetSize.width, imageNaturalSize.width),
          height: Math.max(presetTargetSize.height, imageNaturalSize.height),
        }
      : imageNaturalSize
    const displayScale = Math.min(
      (CANVAS_WIDTH - SCENE_PADDING * 2) / targetNaturalSize.width,
      (CANVAS_HEIGHT - SCENE_PADDING * 2) / targetNaturalSize.height,
    )
    displayScaleRef.current = displayScale

    const centerX = CANVAS_WIDTH / 2
    const centerY = CANVAS_HEIGHT / 2
    const frame = new Rect({
      left: centerX,
      top: centerY,
      originX: 'center',
      originY: 'center',
      width: targetNaturalSize.width * displayScale,
      height: targetNaturalSize.height * displayScale,
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

    void FabricImage.fromURL(imageUrl).then((image) => {
      if (disposed) return
      image.set({
        left: centerX,
        top: centerY,
        originX: 'center',
        originY: 'center',
        scaleX: displayScale,
        scaleY: displayScale,
        selectable: false,
        evented: false,
      })
      imageRef.current = image
      canvas.add(image, frame)
      if (!presetTargetSize) canvas.setActiveObject(frame)
      canvas.requestRenderAll()
    })

    canvas.on('object:scaling', ({ target }) => {
      if (target !== frame || presetTargetSize) return
      const minimumWidth = imageNaturalSize.width * displayScale
      const minimumHeight = imageNaturalSize.height * displayScale
      const scaledWidth = frame.getScaledWidth()
      const scaledHeight = frame.getScaledHeight()
      if (scaledWidth < minimumWidth) frame.scaleX = minimumWidth / frame.width
      if (scaledHeight < minimumHeight) frame.scaleY = minimumHeight / frame.height
      frame.setCoords()
    })

    return () => {
      disposed = true
      frameRef.current = null
      imageRef.current = null
      fabricCanvasRef.current = null
      void canvas.dispose()
    }
  }, [imageNaturalSize, imageUrl, presetTargetSize])

  return (
    <div style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, maxWidth: '100%', touchAction: 'none' }}>
      <canvas ref={canvasElementRef} aria-label="扩图边界画布" style={{ touchAction: 'none' }} />
    </div>
  )
})

export default OutpaintCanvas
