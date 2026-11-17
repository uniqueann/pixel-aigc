import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react'
import {
  AudioMutedOutlined,
  BranchesOutlined,
  CaretRightOutlined,
  CloseOutlined,
  CopyOutlined,
  DeleteOutlined,
  ExpandOutlined,
  AppstoreOutlined,
  LoadingOutlined,
  MinusOutlined,
  PauseOutlined,
  PictureOutlined,
  PlusOutlined,
  RedoOutlined,
  SoundOutlined,
  UndoOutlined,
  UnorderedListOutlined,
  VideoCameraAddOutlined,
  VideoCameraOutlined,
  WarningFilled,
} from '@ant-design/icons'
import { Button, Dropdown, Tooltip } from 'antd'
import { ActiveSelection, Canvas, FabricImage, FabricText, Group, Point, Rect, Shadow, type FabricObject } from 'fabric'
import type { Asset, EditorNode, GenerationJob, GenerationNode, ImageNode, NodeId, VideoNode, ViewportState } from '@/editor/types'
import type { TaskStatus } from '@/types'
import {
  calculateFitViewport,
  calculateNodeBounds,
  calculateRevealViewport,
  clampZoom,
  FIT_PADDING,
  MIN_NODE_SIZE,
  normalizeNodeTransform,
  unionBounds,
} from './geometry'
import { sortedByZIndex, type ZOrderAction } from './zOrder'
import type { FreeCanvasStageHandle, FreeCanvasStageProps, NodeTransform } from './types'
import { capabilityAvailabilityLabel } from '@/components/capabilityAvailability'
import { readCanvasPalette, useCanvasPalette, type CanvasPalette } from './canvasTheme'
import { buildLayerItems, type LayerKind } from './layers'
import { cycleDown, stackAtPoint } from './stacking'

const PLACEHOLDER_LABEL = '#f5f5f4'
const PLACEHOLDER_DETAIL = '#aeb7b4'
const PLACEHOLDER_FILL = '#292f30'
const PLACEHOLDER_STROKE = '#6b7b78'
const PLACEHOLDER_ACTIVE_FILL = '#173b35'
const PLACEHOLDER_ACTIVE_STROKE = '#21cfa0'
const PLACEHOLDER_FAILED_FILL = '#3b2729'
const PLACEHOLDER_FAILED_STROKE = '#ff7875'
const ARTBOARD_BLUR = 18

/** 屏幕坐标 → 画板坐标。 */
function clientPointToCanvas(canvas: Canvas | null, clientX: number, clientY: number) {
  if (!canvas) return { x: 0, y: 0 }
  const rect = canvas.upperCanvasEl.getBoundingClientRect()
  const transform = canvas.viewportTransform
  const zoom = canvas.getZoom()
  return {
    x: (clientX - rect.left - transform[4]) / zoom,
    y: (clientY - rect.top - transform[5]) / zoom,
  }
}

/** 窄屏上留 64px 内边距会把画板压得太小，按容器宽度收一档。 */
function fitPaddingFor(width: number) {
  return width <= 720 ? 24 : FIT_PADDING
}

/** canvas 的 fillStyle 不理解 color-mix，只能把十六进制转成 rgba。 */
function withAlpha(color: string, alpha: number) {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim())
  if (!match) return color
  const value = Number.parseInt(match[1], 16)
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`
}

interface PendingMedia {
  assetUrl: string
  controller: AbortController
}

interface StageCallbacks {
  onSelectNodes: FreeCanvasStageProps['onSelectNodes']
  onTransformNodes: FreeCanvasStageProps['onTransformNodes']
  onViewportChange: FreeCanvasStageProps['onViewportChange']
  onAssetLoadError: FreeCanvasStageProps['onAssetLoadError']
}

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

const LAYER_ICONS: Record<LayerKind, ReactNode> = {
  image: <PictureOutlined />,
  video: <VideoCameraOutlined />,
  generation: <LoadingOutlined />,
}

const GENERATION_LABELS: Record<string, string> = {
  failed: '生成失败的占位框',
  cancelled: '已取消的生成占位框',
  processing: '生成中的占位框',
}

/** 读屏与键盘导航用的节点名称。 */
function nodeLabel(node: EditorNode, generations: Record<string, GenerationJob>) {
  if (node.type === 'generation') {
    const status = generations[node.generationId]?.status
    return (status && GENERATION_LABELS[status]) ?? '排队中的生成占位框'
  }
  const kind = node.type === 'video' ? '视频' : node.type === 'image' ? '图片' : '节点'
  return `${kind}：${node.name}`
}

/** 多选框沿用单选图案，避免 Fabric 默认的浅蓝边框和品牌绿打架。 */
function styleActiveSelection(canvas: Canvas, accent: string) {
  const active = canvas.getActiveObject()
  if (!(active instanceof ActiveSelection)) return
  active.set({
    borderColor: accent,
    borderDashArray: null,
    cornerColor: accent,
    cornerStrokeColor: '#0b6f59',
    cornerStyle: 'circle',
    cornerSize: 11,
    transparentCorners: false,
  })
  active.setCoords()
  // 组内成员单独渲染时也沿用同一套描边，避免默认虚线与浅蓝残留。
  for (const child of active.getObjects()) {
    child.set({ borderColor: accent, borderDashArray: null, cornerColor: accent })
    child.setCoords()
  }
}

function ZOrderMenu({ onReorder, disabled }: { onReorder: (action: ZOrderAction) => void; disabled?: boolean }) {
  return (
    <Dropdown
      trigger={['click']}
      disabled={disabled}
      menu={{
        items: [
          { key: 'front', label: '置顶' },
          { key: 'forward', label: '上移一层' },
          { key: 'backward', label: '下移一层' },
          { key: 'back', label: '置底' },
        ],
        onClick: ({ key }) => onReorder(key as ZOrderAction),
      }}
    >
      <Button size="small" type="text" icon={<AppstoreOutlined />} aria-label="调整层级">层级</Button>
    </Dropdown>
  )
}

function viewportFromCanvas(canvas: Canvas): ViewportState {
  const transform = canvas.viewportTransform
  return {
    zoom: canvas.getZoom(),
    panX: transform[4],
    panY: transform[5],
  }
}

function applyViewport(canvas: Canvas, viewport: ViewportState) {
  canvas.setViewportTransform([viewport.zoom, 0, 0, viewport.zoom, viewport.panX, viewport.panY])
}

function applyNodeToObject(object: FabricImage, node: ImageNode | VideoNode, accent: string) {
  const sourceWidth = object.width || node.width
  const sourceHeight = object.height || node.height
  object.set({
    left: node.x,
    top: node.y,
    originX: 'left',
    originY: 'top',
    scaleX: node.width / sourceWidth,
    scaleY: node.height / sourceHeight,
    angle: node.rotation,
    opacity: node.opacity,
    visible: node.visible,
    selectable: node.visible,
    evented: node.visible,
    lockMovementX: node.locked,
    lockMovementY: node.locked,
    lockRotation: node.locked,
    lockScalingX: node.locked,
    lockScalingY: node.locked,
    lockScalingFlip: true,
    transparentCorners: false,
    cornerColor: accent,
    cornerStrokeColor: '#0b6f59',
    borderColor: accent,
    cornerStyle: 'circle',
    cornerSize: 11,
    padding: 1,
  })
  object.setControlsVisibility({ ml: false, mr: false, mt: false, mb: false })
  object.setCoords()
}

function releaseVideo(video: HTMLVideoElement) {
  video.pause()
  video.removeAttribute('src')
  video.load()
}

function loadVideo(url: string, signal: AbortSignal) {
  return new Promise<HTMLVideoElement>((resolve, reject) => {
    const video = document.createElement('video')
    let settled = false
    video.crossOrigin = 'anonymous'
    video.preload = 'auto'
    video.muted = true
    video.loop = true
    video.playsInline = true

    const cleanup = () => {
      video.removeEventListener('loadeddata', handleLoaded)
      video.removeEventListener('error', handleError)
      signal.removeEventListener('abort', handleAbort)
    }
    const handleLoaded = () => {
      if (settled) return
      settled = true
      cleanup()
      video.width = video.videoWidth
      video.height = video.videoHeight
      resolve(video)
    }
    const handleError = () => {
      if (settled) return
      settled = true
      cleanup()
      releaseVideo(video)
      reject(new Error('浏览器无法解码该视频'))
    }
    const handleAbort = () => {
      if (settled) return
      settled = true
      cleanup()
      releaseVideo(video)
      reject(new DOMException('视频加载已取消', 'AbortError'))
    }
    video.addEventListener('loadeddata', handleLoaded)
    video.addEventListener('error', handleError)
    signal.addEventListener('abort', handleAbort, { once: true })
    video.src = url
    video.load()
  })
}

function readNodeTransform(object: FabricObject, node: EditorNode): NodeTransform {
  // 组变换结束后才能读到画板坐标；调用方保证对象已脱离 ActiveSelection。
  const position = object.getXY()
  if (object instanceof FabricImage) {
    return normalizeNodeTransform({
      x: position.x,
      y: position.y,
      width: object.getScaledWidth(),
      height: object.getScaledHeight(),
      rotation: object.angle,
    })
  }
  return normalizeNodeTransform({ x: position.x, y: position.y, width: node.width, height: node.height, rotation: node.rotation })
}

function generationAppearance(status: TaskStatus | undefined) {
  if (status === 'failed' || status === 'cancelled') {
    return { fill: PLACEHOLDER_FAILED_FILL, stroke: PLACEHOLDER_FAILED_STROKE, label: '生成失败', detail: '可在右侧重试或修改参数' }
  }
  if (status === 'processing') {
    // 占位框底色始终是深色，边框要继续用亮薄荷绿，不跟随主题。
    return { fill: PLACEHOLDER_ACTIVE_FILL, stroke: PLACEHOLDER_ACTIVE_STROKE, label: '生成中', detail: '结果完成后会替换此占位' }
  }
  return { fill: PLACEHOLDER_FILL, stroke: PLACEHOLDER_STROKE, label: '排队中', detail: '正在等待生成任务' }
}

function createGenerationObject(node: GenerationNode, status: TaskStatus | undefined, accent: string) {
  const appearance = generationAppearance(status)
  const background = new Rect({
    left: 0,
    top: 0,
    originX: 'left',
    originY: 'top',
    width: node.width,
    height: node.height,
    rx: 12,
    ry: 12,
    fill: appearance.fill,
    stroke: appearance.stroke,
    strokeWidth: 2,
    strokeDashArray: status === 'failed' || status === 'cancelled' ? undefined : [8, 8],
  })
  const label = new FabricText(appearance.label, {
    left: node.width / 2,
    top: node.height / 2 - 14,
    originX: 'center',
    originY: 'center',
    fill: PLACEHOLDER_LABEL,
    fontFamily: 'sans-serif',
    fontSize: 17,
    fontWeight: 600,
  })
  const detail = new FabricText(appearance.detail, {
    left: node.width / 2,
    top: node.height / 2 + 17,
    originX: 'center',
    originY: 'center',
    fill: PLACEHOLDER_DETAIL,
    fontFamily: 'sans-serif',
    fontSize: 11,
  })
  const object = new Group([background, label, detail], {
    left: node.x,
    top: node.y,
    originX: 'left',
    originY: 'top',
    angle: node.rotation,
    opacity: node.opacity,
    visible: node.visible,
    selectable: node.visible,
    evented: node.visible,
    lockMovementX: node.locked,
    lockMovementY: node.locked,
    lockRotation: true,
    lockScalingX: true,
    lockScalingY: true,
    hasControls: false,
    borderColor: accent,
    padding: 2,
    hoverCursor: node.locked ? 'not-allowed' : 'move',
  })
  object.setCoords()
  return object
}

function applyGenerationNodeToObject(object: FabricObject, node: GenerationNode) {
  object.set({
    left: node.x,
    top: node.y,
    angle: node.rotation,
    opacity: node.opacity,
    visible: node.visible,
    selectable: node.visible,
    evented: node.visible,
    lockMovementX: node.locked,
    lockMovementY: node.locked,
    hoverCursor: node.locked ? 'not-allowed' : 'move',
  })
  object.setCoords()
}

function hasDisplayableUrl(url?: string) {
  return typeof url === 'string' && (url.startsWith('data:') || url.startsWith('blob:'))
}

function createBrokenImageObject(node: ImageNode, accent: string) {
  const background = new Rect({
    left: 0,
    top: 0,
    originX: 'left',
    originY: 'top',
    width: node.width,
    height: node.height,
    rx: 12,
    ry: 12,
    fill: PLACEHOLDER_FAILED_FILL,
    stroke: PLACEHOLDER_FAILED_STROKE,
    strokeWidth: 2,
  })
  const label = new FabricText('图片损坏', {
    left: node.width / 2,
    top: node.height / 2 - 14,
    originX: 'center',
    originY: 'center',
    fill: PLACEHOLDER_LABEL,
    fontFamily: 'sans-serif',
    fontSize: 17,
    fontWeight: 600,
  })
  const detail = new FabricText('无法解码，可按 Delete 删除', {
    left: node.width / 2,
    top: node.height / 2 + 17,
    originX: 'center',
    originY: 'center',
    fill: PLACEHOLDER_DETAIL,
    fontFamily: 'sans-serif',
    fontSize: 11,
  })
  const object = new Group([background, label, detail], {
    left: node.x,
    top: node.y,
    originX: 'left',
    originY: 'top',
    angle: node.rotation,
    opacity: node.opacity,
    visible: node.visible,
    selectable: node.visible,
    evented: node.visible,
    lockMovementX: node.locked,
    lockMovementY: node.locked,
    lockRotation: true,
    lockScalingX: true,
    lockScalingY: true,
    hasControls: false,
    borderColor: accent,
    padding: 2,
    hoverCursor: node.locked ? 'not-allowed' : 'move',
  })
  object.setCoords()
  return object
}

function applyBrokenImageNodeToObject(object: FabricObject, node: ImageNode) {
  object.set({
    left: node.x,
    top: node.y,
    angle: node.rotation,
    opacity: node.opacity,
    visible: node.visible,
    selectable: node.visible,
    evented: node.visible,
    lockMovementX: node.locked,
    lockMovementY: node.locked,
    hoverCursor: node.locked ? 'not-allowed' : 'move',
  })
  object.setCoords()
}

const FreeCanvasStage = forwardRef<FreeCanvasStageHandle, FreeCanvasStageProps>(function FreeCanvasStage({
  scene,
  assets,
  generations,
  selectedNodeIds,
  viewport,
  canUndo,
  canRedo,
  generationActive,
  variationEnabled = false,
  imageToVideoEnabled = false,
  imageToVideoState = imageToVideoEnabled ? 'ready' : 'soon',
  canDeleteSelection = false,
  canDuplicateSelection = false,
  selectionBlockedReason,
  onSelectNodes,
  onTransformNodes,
  onViewportChange,
  onUndo,
  onRedo,
  onDeleteSelection,
  onDuplicateSelection,
  onReorderSelection,
  onNodeGenerationAction,
  onAssetLoadError,
  onFilesDropped,
  onCanvasFocusChange,
  children,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasElementRef = useRef<HTMLCanvasElement>(null)
  const canvasRef = useRef<Canvas | null>(null)
  const artboardRef = useRef<Rect | null>(null)
  const nodeObjectsRef = useRef(new Map<NodeId, FabricObject>())
  const objectNodeIdsRef = useRef(new WeakMap<FabricObject, NodeId>())
  const nodesByIdRef = useRef(new Map<NodeId, EditorNode>())
  const generationStatusesRef = useRef(new Map<NodeId, TaskStatus | undefined>())
  const brokenImageNodesRef = useRef(new Set<NodeId>())
  const pendingMediaRef = useRef(new Map<NodeId, PendingMedia>())
  const objectAssetUrlsRef = useRef(new Map<NodeId, string>())
  const videoElementsRef = useRef(new Map<NodeId, HTMLVideoElement>())
  const videoFrameRef = useRef<number>()
  const wantedNodeIdsRef = useRef(new Set<NodeId>())
  const reportedLoadErrorsRef = useRef(new Set<string>())
  const [mediaLoadVersion, setMediaLoadVersion] = useState(0)
  const callbacksRef = useRef<StageCallbacks>({
    onSelectNodes,
    onTransformNodes,
    onViewportChange,
    onAssetLoadError,
  })
  const viewportRef = useRef(viewport)
  const selectedNodeIdsRef = useRef(new Set<NodeId>(selectedNodeIds))
  const palette = useCanvasPalette()
  const paletteRef = useRef<CanvasPalette>(palette)
  const [themeVersion, setThemeVersion] = useState(0)
  const [focusedNodeId, setFocusedNodeId] = useState<NodeId>()
  const [brokenNodeIds, setBrokenNodeIds] = useState<ReadonlySet<NodeId>>(new Set())
  const [mediaErrorCount, setMediaErrorCount] = useState(0)
  const [videoState, setVideoState] = useState<{ id?: NodeId; paused: boolean; muted: boolean }>({ paused: true, muted: true })
  const [dropActive, setDropActive] = useState(false)
  const [layersOpen, setLayersOpen] = useState(false)
  const sceneSizeRef = useRef({ width: scene.width, height: scene.height })
  const spacePressedRef = useRef(false)
  const panningRef = useRef(false)
  const overlayPanningRef = useRef(false)
  const dismissHintRef = useRef(() => {})
  const [hintDismissed, setHintDismissed] = useState(false)
  const [hintHovered, setHintHovered] = useState(false)
  useEffect(() => { dismissHintRef.current = () => setHintDismissed(true) }, [])
  const reconcilingObjectsRef = useRef(false)
  const lastPointerRef = useRef({ x: 0, y: 0 })
  const pointerOnCanvasRef = useRef<{ clientX: number; clientY: number }>()
  const initialFitAppliedRef = useRef(false)
  const lastStageSizeRef = useRef<{ width: number; height: number }>()
  const altSelectingRef = useRef(false)
  const fitTimerRef = useRef<number>()
  const [videoUiVersion, setVideoUiVersion] = useState(0)

  useEffect(() => { paletteRef.current = palette }, [palette])

  const reloadMedia = useCallback(() => {
    reportedLoadErrorsRef.current.clear()
    setMediaErrorCount(0)
    setMediaLoadVersion((version) => version + 1)
  }, [])

  const startVideoRendering = useCallback(() => {
    if (videoFrameRef.current !== undefined) return
    const renderFrame = () => {
      const hasPlayingVideo = Array.from(videoElementsRef.current.values())
        .some((video) => !video.paused && !video.ended)
      if (!hasPlayingVideo) {
        videoFrameRef.current = undefined
        return
      }
      canvasRef.current?.requestRenderAll()
      videoFrameRef.current = requestAnimationFrame(renderFrame)
    }
    videoFrameRef.current = requestAnimationFrame(renderFrame)
  }, [])

  const toggleVideo = useCallback(async (nodeId: NodeId) => {
    const video = videoElementsRef.current.get(nodeId)
    if (!video) return
    if (video.paused) {
      try {
        await video.play()
        startVideoRendering()
      } catch (error) {
        const node = nodesByIdRef.current.get(nodeId)
        const detail = error instanceof Error ? error.message : '未知错误'
        callbacksRef.current.onAssetLoadError(`视频“${node?.name ?? '生成结果'}”播放失败：${detail}`)
      }
    } else {
      video.pause()
      canvasRef.current?.requestRenderAll()
    }
    setVideoState({ id: nodeId, paused: video.paused, muted: video.muted })
    setVideoUiVersion((version) => version + 1)
  }, [startVideoRendering])

  const toggleVideoMuted = useCallback((nodeId: NodeId) => {
    const video = videoElementsRef.current.get(nodeId)
    if (!video) return
    video.muted = !video.muted
    setVideoState({ id: nodeId, paused: video.paused, muted: video.muted })
    setVideoUiVersion((version) => version + 1)
  }, [])

  const setCanvasViewport = useCallback((next: ViewportState) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const normalized = { ...next, zoom: clampZoom(next.zoom) }
    applyViewport(canvas, normalized)
    canvas.requestRenderAll()
    callbacksRef.current.onViewportChange(normalized)
  }, [])

  const fitToScene = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    setCanvasViewport(calculateFitViewport(
      { width: container.clientWidth, height: container.clientHeight },
      sceneSizeRef.current,
      fitPaddingFor(container.clientWidth),
    ))
    dismissHintRef.current()
  }, [setCanvasViewport])

  /** 把 store 里的选择集同步到 Fabric（支持单选与多选）。 */
  const applySelection = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const wanted = [...selectedNodeIdsRef.current]
      .map((nodeId) => nodeObjectsRef.current.get(nodeId))
      .filter((object): object is FabricObject => !!object)
    const current = canvas.getActiveObjects()
    if (current.length === wanted.length && wanted.every((object) => current.includes(object))) return
    reconcilingObjectsRef.current = true
    canvas.discardActiveObject()
    if (wanted.length === 1) canvas.setActiveObject(wanted[0])
    else if (wanted.length > 1) {
      // 多选框沿用单选图案，避免 Fabric 默认的蓝色边框和品牌绿打架。
      canvas.setActiveObject(new ActiveSelection(wanted, { canvas }))
      styleActiveSelection(canvas, paletteRef.current.accent)
    }
    reconcilingObjectsRef.current = false
    canvas.requestRenderAll()
  }, [])

  const zoomTo = useCallback((zoom: number) => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    canvas.zoomToPoint(new Point(container.clientWidth / 2, container.clientHeight / 2), clampZoom(zoom))
    canvas.requestRenderAll()
    callbacksRef.current.onViewportChange(viewportFromCanvas(canvas))
    dismissHintRef.current()
  }, [])

  useImperativeHandle(ref, () => ({
    getViewportCenter: () => {
      const canvas = canvasRef.current
      const container = containerRef.current
      if (!canvas || !container) return { x: sceneSizeRef.current.width / 2, y: sceneSizeRef.current.height / 2 }
      const transform = canvas.viewportTransform
      const zoom = canvas.getZoom()
      return {
        x: (container.clientWidth / 2 - transform[4]) / zoom,
        y: (container.clientHeight / 2 - transform[5]) / zoom,
      }
    },
    getCanvasPoint: (clientX, clientY) => clientPointToCanvas(canvasRef.current, clientX, clientY),
    getPointerCanvasPoint: () => {
      const pointer = pointerOnCanvasRef.current
      if (!pointer) return undefined
      return clientPointToCanvas(canvasRef.current, pointer.clientX, pointer.clientY)
    },
    revealBounds: (targets) => {
      const canvas = canvasRef.current
      const container = containerRef.current
      if (!canvas || !container || !targets.length) return
      setCanvasViewport(calculateRevealViewport(
        { width: container.clientWidth, height: container.clientHeight },
        targets,
        viewportFromCanvas(canvas),
      ))
    },
    fitToScene: () => { fitToScene() },
    zoomTo: (zoom) => { zoomTo(zoom) },
  }), [fitToScene, setCanvasViewport, zoomTo])

  useEffect(() => {
    callbacksRef.current = { onSelectNodes, onTransformNodes, onViewportChange, onAssetLoadError }
    viewportRef.current = viewport
    selectedNodeIdsRef.current = new Set(selectedNodeIds)
    sceneSizeRef.current = { width: scene.width, height: scene.height }
  }, [onAssetLoadError, onSelectNodes, onTransformNodes, onViewportChange, scene.height, scene.width, selectedNodeIds, viewport])

  const zoomBy = useCallback((factor: number) => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const nextZoom = clampZoom(canvas.getZoom() * factor)
    canvas.zoomToPoint(new Point(container.clientWidth / 2, container.clientHeight / 2), nextZoom)
    canvas.requestRenderAll()
    callbacksRef.current.onViewportChange(viewportFromCanvas(canvas))
    dismissHintRef.current()
  }, [])

  useEffect(() => {
    const canvasElement = canvasElementRef.current
    const container = containerRef.current
    if (!canvasElement || !container) return

    const initialPalette = readCanvasPalette()
    const canvas = new Canvas(canvasElement, {
      backgroundColor: initialPalette.background,
      preserveObjectStacking: true,
      selection: true,
      uniformScaling: true,
      selectionColor: withAlpha(initialPalette.accent, 0.08),
      selectionBorderColor: initialPalette.accent,
      selectionLineWidth: 1,
    })
    canvasRef.current = canvas
    const pendingMedia = pendingMediaRef.current
    const nodeObjects = nodeObjectsRef.current
    const videoElements = videoElementsRef.current
    const objectAssetUrls = objectAssetUrlsRef.current

    const artboard = new Rect({
      left: 0,
      top: 0,
      originX: 'left',
      originY: 'top',
      width: sceneSizeRef.current.width,
      height: sceneSizeRef.current.height,
      fill: initialPalette.artboard,
      stroke: initialPalette.artboardStroke,
      strokeWidth: 1,
      selectable: false,
      evented: false,
      shadow: new Shadow({ color: initialPalette.artboardShadow, blur: ARTBOARD_BLUR, offsetX: 0, offsetY: 6 }),
    })
    artboardRef.current = artboard
    canvas.add(artboard)
    applyViewport(canvas, viewportRef.current)

    /** 尺寸变化后统一在稳定尺寸上重排，避免布局中间态把缩放算到最小档。 */
    const scheduleFit = () => {
      if (fitTimerRef.current) window.clearTimeout(fitTimerRef.current)
      fitTimerRef.current = window.setTimeout(() => {
        const container = containerRef.current
        if (!container) return
        const width = container.clientWidth
        const height = container.clientHeight
        if (width < 120 || height < 120) return
        const fitted = calculateFitViewport({ width, height }, sceneSizeRef.current, fitPaddingFor(width))
        applyViewport(canvas, fitted)
        callbacksRef.current.onViewportChange(fitted)
      }, 140)
    }

    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(1, Math.floor(entry.contentRect.width))
      const height = Math.max(1, Math.floor(entry.contentRect.height))
      canvas.setDimensions({ width, height })
      const previousSize = lastStageSizeRef.current
      lastStageSizeRef.current = { width, height }

      const current = viewportRef.current
      const scene = sceneSizeRef.current
      const fits = scene.width * current.zoom <= width && scene.height * current.zoom <= height
      // 首次挂载：窄屏（手机布局）沿用桌面视口会让画板冲出屏幕；其他情况只在没有视口时按画板居中。
      const initialOverflow = !initialFitAppliedRef.current && (width <= 720 ? !fits : current.zoom === 1 && current.panX === 0 && current.panY === 0)
      const shrank = !!previousSize && (width < previousSize.width * 0.8 || height < previousSize.height * 0.8)
      initialFitAppliedRef.current = true
      if (initialOverflow || shrank) scheduleFit()
      canvas.requestRenderAll()
    })
    observer.observe(container)

    const reportSelection = () => {
      // ⌥ 穿透手势期间由 mouse:down 决定选中谁，Fabric 的"点了空白"不能反过来清空选择。
      if (altSelectingRef.current) return
      styleActiveSelection(canvas, paletteRef.current.accent)
      canvas.requestRenderAll()
      const ids = canvas.getActiveObjects()
        .map((object) => objectNodeIdsRef.current.get(object))
        .filter((id): id is NodeId => !!id)
      callbacksRef.current.onSelectNodes(ids)
    }
    canvas.on('selection:created', reportSelection)
    canvas.on('selection:updated', reportSelection)
    canvas.on('selection:cleared', () => {
      if (panningRef.current || reconcilingObjectsRef.current || altSelectingRef.current) return
      callbacksRef.current.onSelectNodes([])
    })
    canvas.on('mouse:dblclick', ({ target }) => {
      const nodeId = target ? objectNodeIdsRef.current.get(target) : undefined
      const node = nodeId ? nodesByIdRef.current.get(nodeId) : undefined
      if (nodeId && node?.type === 'video') void toggleVideo(nodeId)
    })
    canvas.on('object:scaling', ({ target }) => {
      if (target instanceof ActiveSelection || !(target instanceof FabricImage)) return
      const width = target.getScaledWidth()
      const height = target.getScaledHeight()
      if (width >= MIN_NODE_SIZE && height >= MIN_NODE_SIZE) return
      const adjustment = Math.max(MIN_NODE_SIZE / width, MIN_NODE_SIZE / height)
      target.scaleX *= adjustment
      target.scaleY *= adjustment
      target.setCoords()
    })
    canvas.on('object:modified', ({ target }) => {
      if (target instanceof ActiveSelection) {
        const objects = target.getObjects()
        // 退出选择集会把组变换烘焙回子对象，之后才能读到画板坐标。
        reconcilingObjectsRef.current = true
        canvas.discardActiveObject()
        reconcilingObjectsRef.current = false
        const updates = objects.flatMap((object) => {
          const nodeId = objectNodeIdsRef.current.get(object)
          const node = nodeId ? nodesByIdRef.current.get(nodeId) : undefined
          return nodeId && node ? [{ id: nodeId, transform: readNodeTransform(object, node) }] : []
        })
        if (updates.length) callbacksRef.current.onTransformNodes(updates)
        return
      }
      const nodeId = objectNodeIdsRef.current.get(target)
      const node = nodeId ? nodesByIdRef.current.get(nodeId) : undefined
      if (!nodeId || !node) return
      const transform = readNodeTransform(target, node)
      if (target instanceof FabricImage) {
        target.set({
          left: transform.x,
          top: transform.y,
          angle: transform.rotation,
          scaleX: transform.width / target.width,
          scaleY: transform.height / target.height,
        })
      } else {
        target.set({ left: transform.x, top: transform.y })
      }
      target.setCoords()
      callbacksRef.current.onTransformNodes([{ id: nodeId, transform }])
    })
    canvas.on('object:moving', () => { dismissHintRef.current() })
    canvas.on('object:scaling', () => { dismissHintRef.current() })
    canvas.on('mouse:wheel', ({ e, viewportPoint }) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.ctrlKey || e.metaKey) {
        const nextZoom = clampZoom(canvas.getZoom() * Math.exp(-e.deltaY * 0.0015))
        canvas.zoomToPoint(viewportPoint, nextZoom)
      } else {
        const transform = canvas.viewportTransform
        transform[4] -= e.deltaX
        transform[5] -= e.deltaY
        canvas.setViewportTransform(transform)
      }
      canvas.requestRenderAll()
      callbacksRef.current.onViewportChange(viewportFromCanvas(canvas))
      dismissHintRef.current()
    })
    canvas.on('mouse:move', ({ e }) => {
      if (e instanceof MouseEvent) pointerOnCanvasRef.current = { clientX: e.clientX, clientY: e.clientY }
    })
    canvas.on('mouse:down', ({ e }) => {
      if (e instanceof MouseEvent) pointerOnCanvasRef.current = { clientX: e.clientX, clientY: e.clientY }
    })
    // ⌥ 点击：在被盖住的节点里往下穿透一层（到底回到顶层）。
    canvas.on('mouse:down:before', ({ e }) => {
      if (!(e instanceof MouseEvent) || !e.altKey) return
      const point = clientPointToCanvas(canvas, e.clientX, e.clientY)
      const stack = stackAtPoint([...nodesByIdRef.current.values()], point)
      if (!stack.length) return
      const selected = selectedNodeIdsRef.current
      const next = cycleDown(stack, selected.size === 1 ? [...selected][0] : undefined)
      // 拦下 Fabric 自己"选最上层"的行为，本次手势由这里决定选中谁。
      altSelectingRef.current = true
      canvas.skipTargetFind = true
      if (next) callbacksRef.current.onSelectNodes([next])
      e.preventDefault()
    })
    canvas.on('mouse:down:before', ({ e }) => {
      if (!(e instanceof MouseEvent) || (!spacePressedRef.current && e.button !== 1)) return
      panningRef.current = true
      lastPointerRef.current = { x: e.clientX, y: e.clientY }
      canvas.skipTargetFind = true
      canvas.defaultCursor = 'grabbing'
      canvas.selection = false
      e.preventDefault()
    })
    canvas.on('mouse:move', ({ e }) => {
      if (overlayPanningRef.current || !panningRef.current || !(e instanceof MouseEvent)) return
      const deltaX = e.clientX - lastPointerRef.current.x
      const deltaY = e.clientY - lastPointerRef.current.y
      if (deltaX !== 0 || deltaY !== 0) dismissHintRef.current()
      lastPointerRef.current = { x: e.clientX, y: e.clientY }
      const transform = canvas.viewportTransform
      transform[4] += deltaX
      transform[5] += deltaY
      canvas.setViewportTransform(transform)
      canvas.requestRenderAll()
    })
    canvas.on('mouse:up', () => {
      if (altSelectingRef.current) {
        altSelectingRef.current = false
        canvas.skipTargetFind = false
        return
      }
      if (overlayPanningRef.current || !panningRef.current) return
      panningRef.current = false
      canvas.skipTargetFind = false
      canvas.selection = true
      canvas.defaultCursor = spacePressedRef.current ? 'grab' : 'default'
      callbacksRef.current.onViewportChange(viewportFromCanvas(canvas))
    })

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || isEditableTarget(event.target)) return
      spacePressedRef.current = true
      if (!panningRef.current) canvas.defaultCursor = 'grab'
      event.preventDefault()
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      spacePressedRef.current = false
      if (!panningRef.current) canvas.defaultCursor = 'default'
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    const isChromeControl = (target: EventTarget | null) => (
      target instanceof Element && !!target.closest('.free-canvas-add-image, .free-canvas-help')
    )
    const overlayWheel = (event: WheelEvent) => {
      if (!isChromeControl(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      const rect = canvas.upperCanvasEl.getBoundingClientRect()
      const viewportPoint = new Point(event.clientX - rect.left, event.clientY - rect.top)
      if (event.ctrlKey || event.metaKey) {
        const nextZoom = clampZoom(canvas.getZoom() * Math.exp(-event.deltaY * 0.0015))
        canvas.zoomToPoint(viewportPoint, nextZoom)
      } else {
        const transform = canvas.viewportTransform
        transform[4] -= event.deltaX
        transform[5] -= event.deltaY
        canvas.setViewportTransform(transform)
      }
      canvas.requestRenderAll()
      callbacksRef.current.onViewportChange(viewportFromCanvas(canvas))
      dismissHintRef.current()
    }
    const endOverlayPan = () => {
      if (!overlayPanningRef.current) return
      overlayPanningRef.current = false
      panningRef.current = false
      canvas.skipTargetFind = false
      canvas.selection = true
      canvas.defaultCursor = spacePressedRef.current ? 'grab' : 'default'
      callbacksRef.current.onViewportChange(viewportFromCanvas(canvas))
    }
    const overlayPointerDown = (event: PointerEvent) => {
      if (!isChromeControl(event.target) || (!spacePressedRef.current && event.button !== 1)) return
      overlayPanningRef.current = true
      panningRef.current = true
      lastPointerRef.current = { x: event.clientX, y: event.clientY }
      canvas.skipTargetFind = true
      canvas.defaultCursor = 'grabbing'
      canvas.selection = false
      event.preventDefault()
      event.stopPropagation()
    }
    const overlayPointerMove = (event: PointerEvent) => {
      if (!overlayPanningRef.current) return
      const deltaX = event.clientX - lastPointerRef.current.x
      const deltaY = event.clientY - lastPointerRef.current.y
      if (deltaX !== 0 || deltaY !== 0) dismissHintRef.current()
      lastPointerRef.current = { x: event.clientX, y: event.clientY }
      const transform = canvas.viewportTransform
      transform[4] += deltaX
      transform[5] += deltaY
      canvas.setViewportTransform(transform)
      canvas.requestRenderAll()
    }
    container.addEventListener('wheel', overlayWheel, { passive: false })
    container.addEventListener('pointerdown', overlayPointerDown)
    window.addEventListener('pointermove', overlayPointerMove)
    window.addEventListener('pointerup', endOverlayPan)
    window.addEventListener('pointercancel', endOverlayPan)

    return () => {
      observer.disconnect()
      container.removeEventListener('wheel', overlayWheel)
      container.removeEventListener('pointerdown', overlayPointerDown)
      window.removeEventListener('pointermove', overlayPointerMove)
      window.removeEventListener('pointerup', endOverlayPan)
      window.removeEventListener('pointercancel', endOverlayPan)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      pendingMedia.forEach(({ controller }) => controller.abort())
      pendingMedia.clear()
      videoElements.forEach(releaseVideo)
      videoElements.clear()
      objectAssetUrls.clear()
      if (fitTimerRef.current) window.clearTimeout(fitTimerRef.current)
      if (videoFrameRef.current !== undefined) cancelAnimationFrame(videoFrameRef.current)
      videoFrameRef.current = undefined
      nodeObjects.clear()
      artboardRef.current = null
      canvasRef.current = null
      void canvas.dispose()
    }
  }, [toggleVideo])

  // 主题切换：画布底色、画板纸面、选中色跟着令牌走；占位框整体重建以换配色。
  useEffect(() => {
    const canvas = canvasRef.current
    const artboard = artboardRef.current
    if (!canvas || !artboard) return
    canvas.backgroundColor = palette.background
    canvas.selectionColor = withAlpha(palette.accent, 0.08)
    canvas.selectionBorderColor = palette.accent
    artboard.set({
      fill: palette.artboard,
      stroke: palette.artboardStroke,
      shadow: new Shadow({ color: palette.artboardShadow, blur: ARTBOARD_BLUR, offsetX: 0, offsetY: 6 }),
    })
    artboard.setCoords()
    let droppedPlaceholder = false
    nodeObjectsRef.current.forEach((object, nodeId) => {
      if (object instanceof FabricImage) {
        object.set({ borderColor: palette.accent, cornerColor: palette.accent })
        object.setCoords()
        return
      }
      canvas.remove(object)
      nodeObjectsRef.current.delete(nodeId)
      generationStatusesRef.current.delete(nodeId)
      brokenImageNodesRef.current.delete(nodeId)
      droppedPlaceholder = true
    })
    canvas.requestRenderAll()
    if (droppedPlaceholder) setThemeVersion((version) => version + 1)
  }, [palette])

  useEffect(() => {
    const canvas = canvasRef.current
    const artboard = artboardRef.current
    if (!canvas || !artboard) return
    reconcilingObjectsRef.current = true

    // 组选中时子对象坐标在组内坐标系，先退出选择才能按画板坐标重算。
    if (canvas.getActiveObject() instanceof ActiveSelection) canvas.discardActiveObject()

    /** 单选时才把 Fabric 选中跟着对象走；多选由 applySelection 统一重建。 */
    const selectIfOnlySelected = (nodeId: NodeId, object: FabricObject) => {
      const selected = selectedNodeIdsRef.current
      if (selected.size === 1 && selected.has(nodeId)) canvas.setActiveObject(object)
    }

    artboard.set({ width: scene.width, height: scene.height })
    artboard.setCoords()

    const supportedNodes = scene.nodes
      .filter((node): node is ImageNode | VideoNode | GenerationNode => (
        node.type === 'image' || node.type === 'video' || node.type === 'generation'
      ))
      .slice()
      .sort((a, b) => a.zIndex - b.zIndex)
    const activeAssetUrls = new Set(supportedNodes.flatMap((node) => {
      if (node.type === 'generation') return []
      const asset = assets[node.assetId]
      return asset ? [asset.url] : []
    }))
    let removedStaleError = false
    reportedLoadErrorsRef.current.forEach((url) => {
      if (activeAssetUrls.has(url)) return
      reportedLoadErrorsRef.current.delete(url)
      removedStaleError = true
    })
    if (removedStaleError) {
      setMediaLoadVersion((version) => version + 1)
      setMediaErrorCount(reportedLoadErrorsRef.current.size)
    }
    const wantedNodeIds = new Set(supportedNodes.map((node) => node.id))
    wantedNodeIdsRef.current = wantedNodeIds
    nodesByIdRef.current = new Map(supportedNodes.map((node) => [node.id, node]))

    nodeObjectsRef.current.forEach((object, nodeId) => {
      if (wantedNodeIds.has(nodeId)) return
      canvas.remove(object)
      nodeObjectsRef.current.delete(nodeId)
      generationStatusesRef.current.delete(nodeId)
      brokenImageNodesRef.current.delete(nodeId)
      objectAssetUrlsRef.current.delete(nodeId)
      const video = videoElementsRef.current.get(nodeId)
      if (video) releaseVideo(video)
      videoElementsRef.current.delete(nodeId)
    })
    pendingMediaRef.current.forEach((pending, nodeId) => {
      if (wantedNodeIds.has(nodeId)) return
      pending.controller.abort()
      pendingMediaRef.current.delete(nodeId)
    })

    const reorderObjects = () => {
      canvas.moveObjectTo(artboard, 0)
      supportedNodes.forEach((node, index) => {
        const object = nodeObjectsRef.current.get(node.id)
        if (object) canvas.moveObjectTo(object, index + 1)
      })
    }

    supportedNodes.forEach((node) => {
      const existing = nodeObjectsRef.current.get(node.id)
      if (node.type === 'generation') {
        const status = generations[node.generationId]?.status
        const statusChanged = generationStatusesRef.current.get(node.id) !== status
        if (existing && statusChanged) {
          canvas.remove(existing)
          nodeObjectsRef.current.delete(node.id)
        } else if (existing) {
          applyGenerationNodeToObject(existing, node)
          return
        }

        const placeholder = createGenerationObject(node, status, palette.accent)
        generationStatusesRef.current.set(node.id, status)
        nodeObjectsRef.current.set(node.id, placeholder)
        objectNodeIdsRef.current.set(placeholder, node.id)
        canvas.add(placeholder)
        selectIfOnlySelected(node.id, placeholder)
        return
      }

      if (node.type === 'image') {
        const asset = assets[node.assetId] as (Asset & { loadError?: string }) | undefined
        const isBroken = !asset
          || asset.type !== 'image'
          || Boolean(asset.loadError)
          || (Boolean(asset.url) && reportedLoadErrorsRef.current.has(asset.url))
          || (asset.missing && !asset.objectKey && !asset.storage?.objectKey && !hasDisplayableUrl(asset.url))

        if (isBroken) {
          const wasBroken = brokenImageNodesRef.current.has(node.id)
          if (existing && wasBroken) {
            applyBrokenImageNodeToObject(existing, node)
            return
          }
          if (existing) {
            canvas.remove(existing)
            nodeObjectsRef.current.delete(node.id)
            objectAssetUrlsRef.current.delete(node.id)
            brokenImageNodesRef.current.delete(node.id)
          }
          pendingMediaRef.current.get(node.id)?.controller.abort()
          pendingMediaRef.current.delete(node.id)

          const placeholder = createBrokenImageObject(node, palette.accent)
          brokenImageNodesRef.current.add(node.id)
          nodeObjectsRef.current.set(node.id, placeholder)
          objectNodeIdsRef.current.set(placeholder, node.id)
          canvas.add(placeholder)
          selectIfOnlySelected(node.id, placeholder)
          return
        }

        if (brokenImageNodesRef.current.has(node.id)) {
          if (existing) canvas.remove(existing)
          nodeObjectsRef.current.delete(node.id)
          brokenImageNodesRef.current.delete(node.id)
        }

        if (asset.missing) {
          if (existing) {
            canvas.remove(existing)
            nodeObjectsRef.current.delete(node.id)
            objectAssetUrlsRef.current.delete(node.id)
          }
          pendingMediaRef.current.get(node.id)?.controller.abort()
          pendingMediaRef.current.delete(node.id)
          return
        }

        if (existing instanceof FabricImage && objectAssetUrlsRef.current.get(node.id) === asset.url) {
          applyNodeToObject(existing, node, palette.accent)
          return
        }
        if (existing) {
          canvas.remove(existing)
          nodeObjectsRef.current.delete(node.id)
          objectAssetUrlsRef.current.delete(node.id)
        }

        if (reportedLoadErrorsRef.current.has(asset.url)) return
        const pending = pendingMediaRef.current.get(node.id)
        if (pending?.assetUrl === asset.url) return
        pending?.controller.abort()

        const controller = new AbortController()
        pendingMediaRef.current.set(node.id, { assetUrl: asset.url, controller })
        FabricImage.fromURL(asset.url, { crossOrigin: 'anonymous', signal: controller.signal })
          .then((image) => {
            if (controller.signal.aborted || pendingMediaRef.current.get(node.id)?.controller !== controller || !canvasRef.current || !wantedNodeIdsRef.current.has(node.id)) {
              return
            }
            pendingMediaRef.current.delete(node.id)
            const latestNode = nodesByIdRef.current.get(node.id)
            if (latestNode?.type !== 'image') return
            applyNodeToObject(image, latestNode, palette.accent)
            nodeObjectsRef.current.set(node.id, image)
            objectAssetUrlsRef.current.set(node.id, asset.url)
            objectNodeIdsRef.current.set(image, node.id)
            canvas.add(image)
            reorderObjects()
            selectIfOnlySelected(node.id, image)
            canvas.requestRenderAll()
          })
          .catch((error: unknown) => {
            if (pendingMediaRef.current.get(node.id)?.controller === controller) pendingMediaRef.current.delete(node.id)
            if (controller.signal.aborted || reportedLoadErrorsRef.current.has(asset.url)) return
            reportedLoadErrorsRef.current.add(asset.url)
            setMediaLoadVersion((version) => version + 1)
            const detail = error instanceof Error ? error.message : '未知错误'
            callbacksRef.current.onAssetLoadError(`图片“${asset.name}”加载失败：${detail}`)
          })
        return
      }

      const asset = assets[node.assetId]
      if (!asset || asset.missing || node.type !== 'video' || asset.type !== 'video') {
        if (existing) canvas.remove(existing)
        nodeObjectsRef.current.delete(node.id)
        objectAssetUrlsRef.current.delete(node.id)
        const video = videoElementsRef.current.get(node.id)
        if (video) releaseVideo(video)
        videoElementsRef.current.delete(node.id)
        pendingMediaRef.current.get(node.id)?.controller.abort()
        pendingMediaRef.current.delete(node.id)
        return
      }

      if (existing instanceof FabricImage && objectAssetUrlsRef.current.get(node.id) === asset.url) {
        applyNodeToObject(existing, node, palette.accent)
        return
      }
      if (existing) {
        canvas.remove(existing)
        nodeObjectsRef.current.delete(node.id)
        objectAssetUrlsRef.current.delete(node.id)
        const previousVideo = videoElementsRef.current.get(node.id)
        if (previousVideo) releaseVideo(previousVideo)
        videoElementsRef.current.delete(node.id)
      }

      if (reportedLoadErrorsRef.current.has(asset.url)) return
      const pending = pendingMediaRef.current.get(node.id)
      if (pending?.assetUrl === asset.url) return
      pending?.controller.abort()

      const controller = new AbortController()
      pendingMediaRef.current.set(node.id, { assetUrl: asset.url, controller })
      loadVideo(asset.url, controller.signal)
        .then((video) => {
          if (controller.signal.aborted || pendingMediaRef.current.get(node.id)?.controller !== controller || !canvasRef.current || !wantedNodeIdsRef.current.has(node.id)) {
            releaseVideo(video)
            return
          }
          pendingMediaRef.current.delete(node.id)
          const latestNode = nodesByIdRef.current.get(node.id)
          if (latestNode?.type !== 'video') {
            releaseVideo(video)
            return
          }
          const object = new FabricImage(video)
          applyNodeToObject(object, latestNode, palette.accent)
          nodeObjectsRef.current.set(node.id, object)
          objectAssetUrlsRef.current.set(node.id, asset.url)
          videoElementsRef.current.set(node.id, video)
          objectNodeIdsRef.current.set(object, node.id)
          canvas.add(object)
          reorderObjects()
          selectIfOnlySelected(node.id, object)
          canvas.requestRenderAll()
          setVideoUiVersion((version) => version + 1)
        })
        .catch((error: unknown) => {
          if (pendingMediaRef.current.get(node.id)?.controller === controller) pendingMediaRef.current.delete(node.id)
          if (controller.signal.aborted || reportedLoadErrorsRef.current.has(asset.url)) return
          reportedLoadErrorsRef.current.add(asset.url)
          setMediaLoadVersion((version) => version + 1)
          setMediaErrorCount(reportedLoadErrorsRef.current.size)
          const detail = error instanceof Error ? error.message : '未知错误'
          callbacksRef.current.onAssetLoadError(`视频“${asset.name}”加载失败：${detail}`)
        })
    })

    reorderObjects()
    canvas.requestRenderAll()
    reconcilingObjectsRef.current = false
    applySelection()
    setBrokenNodeIds((previous) => {
      const next = new Set(brokenImageNodesRef.current)
      if (previous.size === next.size && [...next].every((id) => previous.has(id))) return previous
      return next
    })
    setMediaErrorCount(reportedLoadErrorsRef.current.size)
  }, [applySelection, assets, generations, mediaLoadVersion, palette.accent, scene.height, scene.nodes, scene.width, themeVersion])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    applyViewport(canvas, viewport)
    canvas.requestRenderAll()
  }, [viewport])

  useEffect(() => {
    applySelection()
  }, [applySelection, selectedNodeIds, scene.nodes])

  const selectedNodes = useMemo(() => {
    const byId = new Map(scene.nodes.map((node) => [node.id, node]))
    return selectedNodeIds.flatMap((id) => {
      const node = byId.get(id)
      return node ? [node] : []
    })
  }, [scene.nodes, selectedNodeIds])
  const singleSelected = selectedNodes.length === 1 ? selectedNodes[0] : undefined
  const selectedGenerationStatus = singleSelected?.type === 'generation'
    ? generations[singleSelected.generationId]?.status
    : undefined
  const isSelectedTerminalGeneration = singleSelected?.type === 'generation'
    && !!selectedGenerationStatus
    && (selectedGenerationStatus === 'failed' || selectedGenerationStatus === 'cancelled')
  const canDeleteSelected = !!singleSelected && (singleSelected.type !== 'generation' || isSelectedTerminalGeneration)
  const deletableSelection = selectedNodes.length > 1 ? canDeleteSelection : canDeleteSelected
  const selectedVideo = singleSelected?.type === 'video' && videoState.id === singleSelected.id ? videoState : undefined
  const selectedVideoId = singleSelected?.type === 'video' ? singleSelected.id : undefined

  // 播放/静音状态来自 <video> 元素本身，这里把它镜像到 state 供工具栏渲染。
  useEffect(() => {
    if (!selectedVideoId) return
    const video = videoElementsRef.current.get(selectedVideoId)
    if (!video) return
    setVideoState((previous) => previous.id === selectedVideoId && previous.paused === video.paused && previous.muted === video.muted
      ? previous
      : { id: selectedVideoId, paused: video.paused, muted: video.muted })
  }, [mediaLoadVersion, selectedVideoId, videoUiVersion])
  const selectedImage = singleSelected?.type === 'image' && !brokenNodeIds.has(singleSelected.id) ? singleSelected : undefined
  const focusedNode = focusedNodeId ? scene.nodes.find((node) => node.id === focusedNodeId) : undefined

  const layerItems = useMemo(() => buildLayerItems(scene.nodes, assets, generations), [assets, generations, scene.nodes])

  /** 把节点带进视野；已经可见时不移动视口（calculateRevealViewport 会原样返回）。 */
  const revealNode = useCallback((nodeId: NodeId) => {
    const canvas = canvasRef.current
    const container = containerRef.current
    const node = scene.nodes.find((item) => item.id === nodeId)
    if (!canvas || !container || !node) return
    setCanvasViewport(calculateRevealViewport(
      { width: container.clientWidth, height: container.clientHeight },
      [calculateNodeBounds(node)],
      viewportFromCanvas(canvas),
    ))
  }, [scene.nodes, setCanvasViewport])

  const toggleLayerNode = useCallback((nodeId: NodeId) => {
    const next = selectedNodeIds.includes(nodeId)
      ? selectedNodeIds.filter((id) => id !== nodeId)
      : [...selectedNodeIds, nodeId]
    onSelectNodes(next)
  }, [onSelectNodes, selectedNodeIds])

  /** 操作条贴在选择包围盒上方；空间不够时落到下方，且不进入底部工具条占用的区域。 */
  const actionBarStyle = (bounds: ReturnType<typeof calculateNodeBounds>) => {
    const zoom = viewport.zoom
    const top = bounds.top * zoom + viewport.panY
    const bottom = bounds.bottom * zoom + viewport.panY
    const center = (bounds.left + bounds.right) / 2 * zoom + viewport.panX
    const preferredTop = top >= 52 ? top - 48 : bottom + 12
    return {
      top: `clamp(12px, ${preferredTop}px, calc(100% - 118px))`,
      '--bar-center': `${center}px`,
    } as CSSProperties
  }
  const selectionBounds = selectedNodes.length ? unionBounds(selectedNodes.map((node) => calculateNodeBounds(node))) : undefined
  const nodeActionStyle = selectedImage ? actionBarStyle(calculateNodeBounds(selectedImage)) : undefined
  const selectionActionStyle = selectedNodes.length > 1 && selectionBounds ? actionBarStyle(selectionBounds) : undefined
  const focusRingStyle = focusedNode ? (() => {
    const bounds = calculateNodeBounds(focusedNode)
    const zoom = viewport.zoom
    return {
      left: bounds.left * zoom + viewport.panX,
      top: bounds.top * zoom + viewport.panY,
      width: (bounds.right - bounds.left) * zoom,
      height: (bounds.bottom - bounds.top) * zoom,
    }
  })() : undefined

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!onFilesDropped) return
    if (!event.dataTransfer?.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    if (!dropActive) setDropActive(true)
  }
  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!onFilesDropped || !dropActive) return
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setDropActive(false)
  }
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!onFilesDropped) return
    const files = Array.from(event.dataTransfer?.files ?? [])
    if (!files.length) return
    event.preventDefault()
    setDropActive(false)
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.upperCanvasEl.getBoundingClientRect()
    const transform = canvas.viewportTransform
    const zoom = canvas.getZoom()
    onFilesDropped(files, {
      x: (event.clientX - rect.left - transform[4]) / zoom,
      y: (event.clientY - rect.top - transform[5]) / zoom,
    })
  }

  return (
    <div
      className={`free-canvas-stage${dropActive ? ' is-drop-active' : ''}${layersOpen ? ' has-layers' : ''}`}
      ref={containerRef}
      tabIndex={0}
      role="application"
      aria-label="自由画布编辑区域"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onFocus={(event) => {
        onCanvasFocusChange?.(true)
        if (event.target === event.currentTarget && !focusedNodeId && scene.nodes.length) {
          setFocusedNodeId(sortedByZIndex(scene.nodes)[0].id)
        }
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        onCanvasFocusChange?.(false)
        setFocusedNodeId(undefined)
      }}
    >
      <canvas ref={canvasElementRef} aria-hidden="true" />
      <ul className="free-canvas-node-list" hidden={layersOpen}>
        {sortedByZIndex(scene.nodes).map((node) => (
          <li key={node.id}>
            <button
              type="button"
              aria-pressed={selectedNodeIds.includes(node.id)}
              aria-label={`${nodeLabel(node, generations)}，${Math.round(node.width)}×${Math.round(node.height)}${
                selectedNodeIds.includes(node.id) ? '，已选中' : ''}`}
              onFocus={() => {
                setFocusedNodeId(node.id)
                const canvas = canvasRef.current
                const container = containerRef.current
                if (!canvas || !container) return
                setCanvasViewport(calculateRevealViewport(
                  { width: container.clientWidth, height: container.clientHeight },
                  [calculateNodeBounds(node)],
                  viewportFromCanvas(canvas),
                ))
              }}
              onBlur={() => setFocusedNodeId((current) => current === node.id ? undefined : current)}
              onClick={() => onSelectNodes([node.id])}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelectNodes([node.id])
                } else if (event.key === 'Delete' || event.key === 'Backspace') {
                  event.preventDefault()
                  onSelectNodes([node.id])
                  onDeleteSelection()
                }
              }}
            >
              {nodeLabel(node, generations)}
            </button>
          </li>
        ))}
      </ul>
      {focusRingStyle && <div className="free-canvas-focus-ring" style={focusRingStyle} aria-hidden="true" />}
      {dropActive && <div className="free-canvas-dropzone" aria-hidden="true"><span>松开添加到画布</span></div>}

      {layersOpen && <div className="free-canvas-layers" role="group" aria-label="图层">
        <div className="free-canvas-layers-head">
          <span>图层</span>
          <span className="free-canvas-layers-count">{layerItems.length}</span>
          <Button
            size="small"
            type="text"
            icon={<CloseOutlined />}
            onClick={() => setLayersOpen(false)}
            aria-label="关闭图层面板"
          />
        </div>
        {layerItems.length === 0
          ? <p className="free-canvas-layers-empty">画布上还没有内容</p>
          : <ul>
            {layerItems.map((item) => {
              const selected = selectedNodeIds.includes(item.id)
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`free-canvas-layer${selected ? ' is-selected' : ''}`}
                    aria-pressed={selected}
                    aria-label={`${item.name}，${item.meta}${selected ? '，已选中' : ''}`}
                    onClick={(event) => {
                      if (event.shiftKey) toggleLayerNode(item.id)
                      else onSelectNodes([item.id])
                      revealNode(item.id)
                    }}
                    onFocus={() => { setFocusedNodeId(item.id); revealNode(item.id) }}
                    onBlur={() => setFocusedNodeId((current) => current === item.id ? undefined : current)}
                    onKeyDown={(event) => {
                      if (event.key === 'Delete' || event.key === 'Backspace') {
                        event.preventDefault()
                        onSelectNodes([item.id])
                        onDeleteSelection()
                      }
                    }}
                  >
                    <span className="free-canvas-layer-thumb" aria-hidden="true">
                      {item.thumbnail ? <img src={item.thumbnail} alt="" /> : LAYER_ICONS[item.kind]}
                    </span>
                    <span className="free-canvas-layer-copy">
                      <strong>{item.name}</strong>
                      <span>{item.meta}</span>
                    </span>
                    {item.broken && <WarningFilled className="free-canvas-layer-broken" aria-hidden="true" />}
                  </button>
                </li>
              )
            })}
          </ul>}
      </div>}

      <div className="free-canvas-stage-chrome">
        <div
          className={`free-canvas-help${hintDismissed && !hintHovered ? ' is-dismissed' : ''}`}
          onMouseEnter={() => setHintHovered(true)}
          onMouseLeave={() => setHintHovered(false)}
          aria-hidden={hintDismissed && !hintHovered}
        >
          滚轮平移 · ⌘/Ctrl + 滚轮缩放 · 空格拖动画布 · ⌥ 点击选中下层 · 双击视频播放
        </div>
        {children}
      </div>
      {mediaErrorCount > 0 && <div className="free-canvas-media-error" role="status">
        部分媒体加载失败，节点数据已保留。
        <Button size="small" onClick={reloadMedia}>重新加载媒体</Button>
      </div>}
      {selectedImage && nodeActionStyle && (
        <div className="free-canvas-selection-row" style={nodeActionStyle}>
          <div className="free-canvas-node-actions" aria-label="图片派生操作">
            <Tooltip title={variationEnabled ? '基于这张图再生成一版' : '请先确认登录与裂变模型配置'}>
              <span>
                <Button
                  size="small"
                  type="text"
                  icon={<BranchesOutlined />}
                  disabled={generationActive || !variationEnabled}
                  onClick={() => onNodeGenerationAction('variation', selectedImage.id)}
                >
                  裂变
                </Button>
              </span>
            </Tooltip>
            <span className="free-canvas-node-actions-divider" />
            <Tooltip title={imageToVideoEnabled ? '让这张图片动起来' : `视频生成${capabilityAvailabilityLabel(imageToVideoState)}`}>
              <span><Button
                size="small"
                type="text"
                icon={<VideoCameraAddOutlined />}
                disabled={generationActive || !imageToVideoEnabled}
                onClick={() => onNodeGenerationAction('image-to-video', selectedImage.id)}
              >图生视频</Button></span>
            </Tooltip>
            <span className="free-canvas-node-actions-divider" />
            <ZOrderMenu onReorder={onReorderSelection} disabled={generationActive} />
            <span className="free-canvas-node-actions-divider" />
            <Tooltip title={"删除图片（Delete / Backspace）"}>
              <span>
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  disabled={generationActive || !canDeleteSelected}
                  onClick={onDeleteSelection}
                >
                  删除
                </Button>
              </span>
            </Tooltip>
          </div>
        </div>
      )}
      {selectionActionStyle && (
        <div className="free-canvas-selection-row" style={selectionActionStyle}>
          <div className="free-canvas-node-actions" aria-label="多选操作">
            <span className="free-canvas-selection-count">已选 {selectedNodes.length} 项</span>
            <span className="free-canvas-node-actions-divider" />
            <Tooltip title={canDuplicateSelection ? '复制所选（⌘/Ctrl+D）' : selectionBlockedReason ?? '所选内容无法复制'}>
              <span>
                <Button
                  size="small"
                  type="text"
                  icon={<CopyOutlined />}
                  disabled={generationActive || !canDuplicateSelection}
                  onClick={onDuplicateSelection}
                >复制</Button>
              </span>
            </Tooltip>
            <span className="free-canvas-node-actions-divider" />
            <ZOrderMenu onReorder={onReorderSelection} disabled={generationActive} />
            <span className="free-canvas-node-actions-divider" />
            <Tooltip title={canDeleteSelection ? '删除所选（Delete）' : selectionBlockedReason ?? '所选内容无法删除'}>
              <span>
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  disabled={generationActive || !canDeleteSelection}
                  onClick={onDeleteSelection}
                >删除</Button>
              </span>
            </Tooltip>
          </div>
        </div>
      )}
      <div className="free-canvas-toolbar" aria-label="画布工具栏">
        <Tooltip title="撤销（⌘/Ctrl+Z）"><Button type="text" icon={<UndoOutlined />} disabled={!canUndo} onClick={onUndo} aria-label="撤销" /></Tooltip>
        <Tooltip title="重做（⇧⌘/Ctrl+Z）"><Button type="text" icon={<RedoOutlined />} disabled={!canRedo} onClick={onRedo} aria-label="重做" /></Tooltip>
        <span className="free-canvas-toolbar-divider" />
        <Tooltip
          title={
            singleSelected?.type === 'generation'
              ? (isSelectedTerminalGeneration ? '删除占位框' : '生成中的占位框暂不支持删除')
              : selectedNodes.length > 1
                ? (canDeleteSelection ? '删除所选节点' : selectionBlockedReason ?? '所选内容无法删除')
                : '删除所选节点'
          }
        >
          <Button type="text" danger icon={<DeleteOutlined />} disabled={!deletableSelection} onClick={onDeleteSelection} aria-label="删除节点" />
        </Tooltip>
        {singleSelected?.type === 'video' && (
          <>
            <span className="free-canvas-toolbar-divider" />
            <Tooltip title={selectedVideo?.paused ? '播放视频' : '暂停视频'}>
              <Button
                type="text"
                icon={selectedVideo?.paused ? <CaretRightOutlined /> : <PauseOutlined />}
                disabled={!selectedVideo}
                onClick={() => { void toggleVideo(singleSelected.id) }}
                aria-label={selectedVideo?.paused ? '播放视频' : '暂停视频'}
              />
            </Tooltip>
            <Tooltip title={selectedVideo?.muted ? '取消静音' : '静音'}>
              <Button
                type="text"
                icon={selectedVideo?.muted ? <AudioMutedOutlined /> : <SoundOutlined />}
                disabled={!selectedVideo}
                onClick={() => toggleVideoMuted(singleSelected.id)}
                aria-label={selectedVideo?.muted ? '取消静音' : '静音'}
              />
            </Tooltip>
          </>
        )}
        <span className="free-canvas-toolbar-divider" />
        <Tooltip title={layersOpen ? '关闭图层' : '图层（按叠放顺序列出画布内容）'}>
          <Button
            type="text"
            icon={<UnorderedListOutlined />}
            className={layersOpen ? 'is-active' : undefined}
            aria-pressed={layersOpen}
            onClick={() => setLayersOpen((value) => !value)}
            aria-label="图层"
          />
        </Tooltip>
        <span className="free-canvas-toolbar-divider" />
        <Tooltip title="缩小"><Button type="text" icon={<MinusOutlined />} onClick={() => zoomBy(0.8)} aria-label="缩小画布" /></Tooltip>
        <span className="free-canvas-zoom-label">{Math.round(viewport.zoom * 100)}%</span>
        <Tooltip title="放大"><Button type="text" icon={<PlusOutlined />} onClick={() => zoomBy(1.25)} aria-label="放大画布" /></Tooltip>
        <Tooltip title="适合画板"><Button type="text" icon={<ExpandOutlined />} onClick={fitToScene} aria-label="适合画板" /></Tooltip>
      </div>
    </div>
  )
})

export default FreeCanvasStage
