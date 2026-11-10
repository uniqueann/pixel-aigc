import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState, type KeyboardEvent } from 'react'
import { Canvas, FabricImage, Rect } from 'fabric'
import { computeOutpaintMask, type MaskExportResult } from '../../utils/maskExport'
import { useCanvasDisplay } from '../../utils/useCanvasDisplay'
import type { OutpaintOutputMode } from '@shared/outpaint'
import {
  clampOutpaintTargetSize,
  freeOutpaintDisplayScale,
  freeOutpaintGeometry,
  modelSizeFromDisplay,
  nudgeOutpaintTargetSize,
  OUTPAINT_FRAME_COLOR,
  OUTPAINT_VIEW_HEIGHT,
  OUTPAINT_VIEW_PADDING,
  OUTPAINT_VIEW_WIDTH,
  outpaintControlSizes,
  outpaintDisplayScale,
  outpaintPadStrips,
  presetOutpaintGeometry,
  type OutpaintModelGeometry,
} from '../../utils/outpaintGeometry'

interface OutpaintCanvasProps {
  imageUrl: string
  imageNaturalSize: { width: number; height: number }
  /** 选中平台预设时传入目标尺寸；为空时允许自由拖拽 */
  presetTargetSize?: { width: number; height: number }
  outputMode?: OutpaintOutputMode
  /** 当前目标尺寸，用于读屏描述与键盘提示。 */
  targetSize?: { width: number; height: number }
  /** 正在对比扩图前原图：覆盖画布并停止拖拽/键盘调整。 */
  comparing?: boolean
  /** 对比时显示的原图地址。 */
  compareImageUrl?: string
  onTargetSizeChange?: (size: { width: number; height: number }) => void
}

/** 键盘微调：方向键 32px，Shift+方向键 128px。 */
const KEYBOARD_STEP = 32
const KEYBOARD_STEP_FAST = 128

export interface OutpaintCanvasHandle {
  exportMask: () => MaskExportResult
  getTargetSize: () => { width: number; height: number }
  getOriginOffset: () => { x: number; y: number }
  getSourceSize: () => { width: number; height: number }
  /** 自由拖拽：恢复到原图尺寸与初始取景。 */
  reset: () => void
  /** 自由拖拽：按精确宽高回填目标尺寸，超出服务端范围时自动收口。 */
  setTargetSize: (size: { width: number; height: number }) => void
}

/**
 * 控制点视觉保持小而触控热区放大：
 * Fabric 默认用同一尺寸绘制和命中，这里给每个控制点分别设置 size 与 touchSize。
 */
function applyControlSizes(frame: Rect, stageScale: number) {
  const { visual, touch } = outpaintControlSizes(stageScale)
  frame.set({ cornerSize: visual, touchCornerSize: touch })
  for (const control of Object.values(frame.controls)) {
    control.sizeX = visual
    control.sizeY = visual
    control.touchSizeX = touch
    control.touchSizeY = touch
  }
  frame.setCoords()
}

const OutpaintCanvas = forwardRef<OutpaintCanvasHandle, OutpaintCanvasProps>(function OutpaintCanvas(
  { imageUrl, imageNaturalSize, presetTargetSize, outputMode = 'original', targetSize, comparing = false, compareImageUrl, onTargetSizeChange },
  ref,
) {
  const { hostRef, display } = useCanvasDisplay()
  const keyboardHelpId = useId()
  const [keyboardActive, setKeyboardActive] = useState(false)
  const canvasElementRef = useRef<HTMLCanvasElement>(null)
  const fabricCanvasRef = useRef<Canvas | null>(null)
  const frameRef = useRef<Rect | null>(null)
  const modelRef = useRef<OutpaintModelGeometry | null>(null)
  // 命令式方法需要拿到 effect 内的画布与几何，用 ref 桥接，避免句柄随 effect 重建。
  const resetRef = useRef<() => void>(() => undefined)
  const setTargetSizeRef = useRef<(size: { width: number; height: number }) => void>(() => undefined)
  const nudgeRef = useRef<(axis: 'width' | 'height', direction: 1 | -1, step: number) => void>(() => undefined)
  // 主 effect 不因窗口缩放重建画布；控制点尺寸通过 ref 读取最新缩放。
  const stageScaleRef = useRef(display.scale)
  useEffect(() => {
    stageScaleRef.current = display.scale
  }, [display.scale])

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
      reset: () => resetRef.current(),
      setTargetSize: (size) => setTargetSizeRef.current(size),
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

    const source = imageNaturalSize
    const model = presetTargetSize
      ? presetOutpaintGeometry(
        source.width,
        source.height,
        presetTargetSize.width,
        presetTargetSize.height,
        outputMode,
      )
      : freeOutpaintGeometry(source.width, source.height, source.width, source.height)
    modelRef.current = model
    onTargetSizeChange?.(model.targetSize)

    const centerX = OUTPAINT_VIEW_WIDTH / 2
    const centerY = OUTPAINT_VIEW_HEIGHT / 2
    // 自由拖拽先按 1.5 倍留白取景；预设模式则完整装下目标尺寸。
    let displayScale = presetTargetSize
      ? outpaintDisplayScale(model.targetSize.width, model.targetSize.height)
      : freeOutpaintDisplayScale(source.width, source.height, model.targetSize.width, model.targetSize.height)

    const frame = new Rect({
      left: centerX,
      top: centerY,
      originX: 'center',
      originY: 'center',
      width: model.targetSize.width * displayScale,
      height: model.targetSize.height * displayScale,
      // 填充交给下方的扩图区色块，边框本身保持透明，避免把原图整体染绿。
      fill: 'transparent',
      stroke: OUTPAINT_FRAME_COLOR,
      strokeWidth: 2,
      strokeDashArray: [8, 6],
      lockMovementX: true,
      lockMovementY: true,
      lockRotation: true,
      selectable: !presetTargetSize,
      evented: !presetTargetSize,
      // 移动被锁定，悬停不要再显示 move 光标，避免暗示可以整体拖动。
      hoverCursor: 'default',
      transparentCorners: false,
      cornerColor: OUTPAINT_FRAME_COLOR,
      borderColor: OUTPAINT_FRAME_COLOR,
    })
    frame.setControlsVisibility({ mtr: false })
    // 画布被 CSS 缩放后反向补偿：视觉可小，触控热区不小于 24px。
    applyControlSizes(frame, stageScaleRef.current)
    frameRef.current = frame

    // 扩图区色块：只覆盖原图之外的新增区域，随目标尺寸一起更新。
    const padStrips = Array.from({ length: 4 }, () => new Rect({
      originX: 'left',
      originY: 'top',
      fill: 'rgba(15, 143, 111, 0.12)',
      strokeWidth: 0,
      selectable: false,
      evented: false,
    }))
    const updatePadStrips = (next: OutpaintModelGeometry) => {
      const strips = outpaintPadStrips(
        next.targetSize,
        next.originOffset,
        next.sourceSize,
        displayScale,
        { x: centerX, y: centerY },
      )
      padStrips.forEach((strip, index) => {
        const box = strips[index]
        strip.set({ left: box.left, top: box.top, width: box.width, height: box.height })
        strip.setCoords()
      })
    }

    let image: FabricImage | null = null

    const renderModel = (next: OutpaintModelGeometry) => {
      displayScale = presetTargetSize
        ? outpaintDisplayScale(next.targetSize.width, next.targetSize.height)
        : freeOutpaintDisplayScale(source.width, source.height, next.targetSize.width, next.targetSize.height)
      frame.set({
        left: centerX,
        top: centerY,
        width: next.targetSize.width * displayScale,
        height: next.targetSize.height * displayScale,
        scaleX: 1,
        scaleY: 1,
      })
      frame.setCoords()
      updatePadStrips(next)
      if (image) {
        const offsetX = (next.originOffset.x + next.sourceSize.width / 2 - next.targetSize.width / 2) * displayScale
        const offsetY = (next.originOffset.y + next.sourceSize.height / 2 - next.targetSize.height / 2) * displayScale
        image.set({
          left: centerX + offsetX,
          top: centerY + offsetY,
          scaleX: (next.sourceSize.width * displayScale) / source.width,
          scaleY: (next.sourceSize.height * displayScale) / source.height,
        })
        image.setCoords()
      }
      canvas.requestRenderAll()
    }

    const applyModel = (next: OutpaintModelGeometry) => {
      modelRef.current = next
      renderModel(next)
      onTargetSizeChange?.(next.targetSize)
    }

    resetRef.current = () => {
      if (presetTargetSize) return
      applyModel(freeOutpaintGeometry(source.width, source.height, source.width, source.height))
    }
    setTargetSizeRef.current = (size) => {
      if (presetTargetSize) return
      const clamped = clampOutpaintTargetSize(source.width, source.height, size.width, size.height)
      applyModel(freeOutpaintGeometry(source.width, source.height, clamped.size.width, clamped.size.height))
    }
    nudgeRef.current = (axis, direction, step) => {
      if (presetTargetSize) return
      const current = modelRef.current
      if (!current) return
      const next = nudgeOutpaintTargetSize(source.width, source.height, current.targetSize, axis, direction, step)
      applyModel(freeOutpaintGeometry(source.width, source.height, next.size.width, next.size.height))
    }

    const applyFreeFrame = () => {
      if (presetTargetSize) return modelRef.current
      const size = modelSizeFromDisplay(frame.getScaledWidth(), frame.getScaledHeight(), displayScale)
      const clamped = clampOutpaintTargetSize(source.width, source.height, size.width, size.height)
      const next = freeOutpaintGeometry(source.width, source.height, clamped.size.width, clamped.size.height)
      modelRef.current = next
      onTargetSizeChange?.(next.targetSize)
      return next
    }

    void FabricImage.fromURL(imageUrl).then((loaded) => {
      if (disposed) return
      image = loaded
      image.set({
        originX: 'center',
        originY: 'center',
        selectable: false,
        evented: false,
      })
      canvas.add(image, ...padStrips, frame)
      renderModel(modelRef.current ?? model)
      if (!presetTargetSize) canvas.setActiveObject(frame)
      canvas.requestRenderAll()
    })

    canvas.on('object:scaling', ({ target }) => {
      if (target !== frame || presetTargetSize) return
      const minimumWidth = source.width * displayScale
      const minimumHeight = source.height * displayScale
      // 上限留在可视区内，保证 8 个控制点始终抓得到。
      const maximumWidth = OUTPAINT_VIEW_WIDTH - OUTPAINT_VIEW_PADDING * 2
      const maximumHeight = OUTPAINT_VIEW_HEIGHT - OUTPAINT_VIEW_PADDING * 2
      if (frame.getScaledWidth() < minimumWidth) frame.scaleX = minimumWidth / frame.width
      if (frame.getScaledHeight() < minimumHeight) frame.scaleY = minimumHeight / frame.height
      if (frame.getScaledWidth() > maximumWidth) frame.scaleX = maximumWidth / frame.width
      if (frame.getScaledHeight() > maximumHeight) frame.scaleY = maximumHeight / frame.height
      applyFreeFrame()
      frame.setCoords()
    })

    canvas.on('object:modified', ({ target }) => {
      if (target !== frame || presetTargetSize) return
      const next = applyFreeFrame()
      if (!next) return
      applyModel(next)
    })

    // 指针拖到画布外时，避免浏览器把拖拽变成右侧面板的文本选择。
    canvas.on('mouse:down', (event) => {
      if (event.target === frame) event.e.preventDefault()
    })

    return () => {
      disposed = true
      resetRef.current = () => undefined
      setTargetSizeRef.current = () => undefined
      nudgeRef.current = () => undefined
      frameRef.current = null
      modelRef.current = null
      fabricCanvasRef.current = null
      void canvas.dispose()
    }
  }, [imageNaturalSize, imageUrl, presetTargetSize, outputMode, onTargetSizeChange])

  // 窗口或容器尺寸变化只改 CSS 缩放；同步放大控制点，避免热区随画面一起缩小。
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    applyControlSizes(frame, display.scale)
    fabricCanvasRef.current?.requestRenderAll()
  }, [display.scale])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      hostRef.current?.blur()
      return
    }
    // 平台预设由服务端尺寸决定，键盘不改变边框。
    if (presetTargetSize) return
    // 对比原图时边框不可见，方向键不改变目标尺寸。
    if (comparing) return
    const step = event.shiftKey ? KEYBOARD_STEP_FAST : KEYBOARD_STEP
    const directions: Record<string, ['width' | 'height', 1 | -1]> = {
      ArrowLeft: ['width', -1],
      ArrowRight: ['width', 1],
      ArrowUp: ['height', -1],
      ArrowDown: ['height', 1],
    }
    const direction = directions[event.key]
    if (!direction) return
    event.preventDefault()
    nudgeRef.current(direction[0], direction[1], step)
  }

  const handleFocus = () => {
    if (hostRef.current?.matches(':focus-visible')) setKeyboardActive(true)
  }
  const handleBlur = () => setKeyboardActive(false)

  return (
    <div
      ref={hostRef}
      className="workstation-paint-host"
      tabIndex={0}
      role="application"
      aria-label="扩图边界画布"
      aria-describedby={keyboardHelpId}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      <p id={keyboardHelpId} className="sr-only">
        {comparing
          ? '正在查看扩图前原图；切回「结果」可继续扩图。Esc 退出画布。'
          : presetTargetSize
            ? `平台预设目标 ${targetSize ? `${targetSize.width} × ${targetSize.height} 像素` : '已锁定'}，边框不可拖拽；Esc 退出画布。`
            : `当前目标 ${targetSize ? `${targetSize.width} × ${targetSize.height} 像素` : '尚未确定'}。使用左右方向键调整目标宽度，上下方向键调整目标高度；按住 Shift 每次调整 ${KEYBOARD_STEP_FAST} 像素；Esc 退出画布。`}
      </p>
      <div className="workstation-paint-frame" style={{ width: display.width, height: display.height }}>
        <div
          className="workstation-paint-stage"
          style={{
            width: OUTPAINT_VIEW_WIDTH,
            height: OUTPAINT_VIEW_HEIGHT,
            transform: `scale(${display.scale})`,
          }}
        >
          <canvas ref={canvasElementRef} aria-hidden="true" style={{ touchAction: 'none' }} />
          {comparing && compareImageUrl ? (
            <div className="workstation-outpaint-compare" aria-hidden="true">
              <img src={compareImageUrl} alt="" />
            </div>
          ) : null}
        </div>
        {keyboardActive && !comparing ? (
          <div className="workstation-paint-keyboard-hint">
            {presetTargetSize ? '平台预设已锁定' : '方向键调整 · Shift 加速'}
          </div>
        ) : null}
      </div>
    </div>
  )
})

export default OutpaintCanvas
