import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import {
  AudioMutedOutlined,
  BranchesOutlined,
  CaretRightOutlined,
  DeleteOutlined,
  ExpandOutlined,
  MinusOutlined,
  PauseOutlined,
  PlusOutlined,
  RedoOutlined,
  SoundOutlined,
  UndoOutlined,
  VideoCameraAddOutlined,
} from '@ant-design/icons'
import { Button, Tooltip } from 'antd'
import { Canvas, FabricImage, FabricText, Group, Point, Rect, Shadow, type FabricObject } from 'fabric'
import type { EditorNode, GenerationNode, ImageNode, NodeId, VideoNode, ViewportState } from '@/editor/types'
import type { TaskStatus } from '@/types'
import {
  calculateFitViewport,
  calculateNodeBounds,
  clampZoom,
  MIN_NODE_SIZE,
  normalizeNodeTransform,
} from './geometry'
import type { FreeCanvasStageHandle, FreeCanvasStageProps, NodeTransform } from './types'

const ARTBOARD_FILL = '#f7f7f5'
const ARTBOARD_STROKE = '#d6d6d2'
const SELECTION_COLOR = '#21cfa0'

interface PendingMedia {
  assetUrl: string
  controller: AbortController
}

interface StageCallbacks {
  onSelectNode: FreeCanvasStageProps['onSelectNode']
  onTransformNode: FreeCanvasStageProps['onTransformNode']
  onViewportChange: FreeCanvasStageProps['onViewportChange']
  onAssetLoadError: FreeCanvasStageProps['onAssetLoadError']
}

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
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

function applyNodeToObject(object: FabricImage, node: ImageNode | VideoNode) {
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
    cornerColor: SELECTION_COLOR,
    cornerStrokeColor: '#0b6f59',
    borderColor: SELECTION_COLOR,
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

function readNodeTransform(object: FabricImage): NodeTransform {
  return normalizeNodeTransform({
    x: object.left,
    y: object.top,
    width: object.getScaledWidth(),
    height: object.getScaledHeight(),
    rotation: object.angle,
  })
}

function generationAppearance(status: TaskStatus | undefined) {
  if (status === 'failed' || status === 'cancelled') {
    return { fill: '#3b2729', stroke: '#ff7875', label: '生成失败', detail: '可在右侧重试或修改参数' }
  }
  if (status === 'processing') {
    return { fill: '#173b35', stroke: SELECTION_COLOR, label: '生成中', detail: '结果完成后会替换此占位' }
  }
  return { fill: '#292f30', stroke: '#6b7b78', label: '排队中', detail: '正在等待生成任务' }
}

function createGenerationObject(node: GenerationNode, status: TaskStatus | undefined) {
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
    fill: '#f5f5f4',
    fontFamily: 'sans-serif',
    fontSize: 17,
    fontWeight: 600,
  })
  const detail = new FabricText(appearance.detail, {
    left: node.width / 2,
    top: node.height / 2 + 17,
    originX: 'center',
    originY: 'center',
    fill: '#aeb7b4',
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
    borderColor: SELECTION_COLOR,
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

const FreeCanvasStage = forwardRef<FreeCanvasStageHandle, FreeCanvasStageProps>(function FreeCanvasStage({
  scene,
  assets,
  generations,
  selectedNodeId,
  viewport,
  canUndo,
  canRedo,
  generationActive,
  onSelectNode,
  onTransformNode,
  onViewportChange,
  onUndo,
  onRedo,
  onDelete,
  onNodeGenerationAction,
  onAssetLoadError,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasElementRef = useRef<HTMLCanvasElement>(null)
  const canvasRef = useRef<Canvas | null>(null)
  const artboardRef = useRef<Rect | null>(null)
  const nodeObjectsRef = useRef(new Map<NodeId, FabricObject>())
  const objectNodeIdsRef = useRef(new WeakMap<FabricObject, NodeId>())
  const nodesByIdRef = useRef(new Map<NodeId, EditorNode>())
  const generationStatusesRef = useRef(new Map<NodeId, TaskStatus | undefined>())
  const pendingMediaRef = useRef(new Map<NodeId, PendingMedia>())
  const objectAssetUrlsRef = useRef(new Map<NodeId, string>())
  const videoElementsRef = useRef(new Map<NodeId, HTMLVideoElement>())
  const videoFrameRef = useRef<number>()
  const wantedNodeIdsRef = useRef(new Set<NodeId>())
  const reportedLoadErrorsRef = useRef(new Set<string>())
  const callbacksRef = useRef<StageCallbacks>({
    onSelectNode,
    onTransformNode,
    onViewportChange,
    onAssetLoadError,
  })
  const viewportRef = useRef(viewport)
  const selectedNodeIdRef = useRef(selectedNodeId)
  const sceneSizeRef = useRef({ width: scene.width, height: scene.height })
  const spacePressedRef = useRef(false)
  const panningRef = useRef(false)
  const reconcilingObjectsRef = useRef(false)
  const lastPointerRef = useRef({ x: 0, y: 0 })
  const initialFitAppliedRef = useRef(false)
  const [, setVideoUiVersion] = useState(0)

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
    setVideoUiVersion((version) => version + 1)
  }, [startVideoRendering])

  const toggleVideoMuted = useCallback((nodeId: NodeId) => {
    const video = videoElementsRef.current.get(nodeId)
    if (!video) return
    video.muted = !video.muted
    setVideoUiVersion((version) => version + 1)
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
  }), [])

  useEffect(() => {
    callbacksRef.current = { onSelectNode, onTransformNode, onViewportChange, onAssetLoadError }
    viewportRef.current = viewport
    selectedNodeIdRef.current = selectedNodeId
    sceneSizeRef.current = { width: scene.width, height: scene.height }
  }, [onAssetLoadError, onSelectNode, onTransformNode, onViewportChange, scene.height, scene.width, selectedNodeId, viewport])

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
    ))
  }, [setCanvasViewport])

  const zoomBy = useCallback((factor: number) => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const nextZoom = clampZoom(canvas.getZoom() * factor)
    canvas.zoomToPoint(new Point(container.clientWidth / 2, container.clientHeight / 2), nextZoom)
    canvas.requestRenderAll()
    callbacksRef.current.onViewportChange(viewportFromCanvas(canvas))
  }, [])

  useEffect(() => {
    const canvasElement = canvasElementRef.current
    const container = containerRef.current
    if (!canvasElement || !container) return

    const canvas = new Canvas(canvasElement, {
      backgroundColor: '#303035',
      preserveObjectStacking: true,
      selection: false,
      uniformScaling: true,
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
      fill: ARTBOARD_FILL,
      stroke: ARTBOARD_STROKE,
      strokeWidth: 1,
      selectable: false,
      evented: false,
      shadow: new Shadow({ color: 'rgba(0, 0, 0, 0.28)', blur: 18, offsetX: 0, offsetY: 6 }),
    })
    artboardRef.current = artboard
    canvas.add(artboard)
    applyViewport(canvas, viewportRef.current)

    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(1, Math.floor(entry.contentRect.width))
      const height = Math.max(1, Math.floor(entry.contentRect.height))
      canvas.setDimensions({ width, height })

      if (!initialFitAppliedRef.current) {
        initialFitAppliedRef.current = true
        const current = viewportRef.current
        if (current.zoom === 1 && current.panX === 0 && current.panY === 0) {
          const fitted = calculateFitViewport({ width, height }, sceneSizeRef.current)
          applyViewport(canvas, fitted)
          callbacksRef.current.onViewportChange(fitted)
        }
      }
      canvas.requestRenderAll()
    })
    observer.observe(container)

    canvas.on('selection:created', ({ selected }) => {
      callbacksRef.current.onSelectNode(selected[0] ? objectNodeIdsRef.current.get(selected[0]) : undefined)
    })
    canvas.on('selection:updated', ({ selected }) => {
      callbacksRef.current.onSelectNode(selected[0] ? objectNodeIdsRef.current.get(selected[0]) : undefined)
    })
    canvas.on('selection:cleared', () => {
      if (!panningRef.current && !reconcilingObjectsRef.current) callbacksRef.current.onSelectNode()
    })
    canvas.on('mouse:dblclick', ({ target }) => {
      const nodeId = target ? objectNodeIdsRef.current.get(target) : undefined
      const node = nodeId ? nodesByIdRef.current.get(nodeId) : undefined
      if (nodeId && node?.type === 'video') void toggleVideo(nodeId)
    })
    canvas.on('object:scaling', ({ target }) => {
      if (!(target instanceof FabricImage)) return
      const width = target.getScaledWidth()
      const height = target.getScaledHeight()
      if (width >= MIN_NODE_SIZE && height >= MIN_NODE_SIZE) return
      const adjustment = Math.max(MIN_NODE_SIZE / width, MIN_NODE_SIZE / height)
      target.scaleX *= adjustment
      target.scaleY *= adjustment
      target.setCoords()
    })
    canvas.on('object:modified', ({ target }) => {
      const nodeId = objectNodeIdsRef.current.get(target)
      const node = nodeId ? nodesByIdRef.current.get(nodeId) : undefined
      if (!nodeId || !node) return
      const transform = target instanceof FabricImage
        ? readNodeTransform(target)
        : normalizeNodeTransform({
          x: target.left,
          y: target.top,
          width: node.width,
          height: node.height,
          rotation: node.rotation,
        })
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
      callbacksRef.current.onTransformNode(nodeId, transform)
    })
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
      if (!panningRef.current || !(e instanceof MouseEvent)) return
      const deltaX = e.clientX - lastPointerRef.current.x
      const deltaY = e.clientY - lastPointerRef.current.y
      lastPointerRef.current = { x: e.clientX, y: e.clientY }
      const transform = canvas.viewportTransform
      transform[4] += deltaX
      transform[5] += deltaY
      canvas.setViewportTransform(transform)
      canvas.requestRenderAll()
    })
    canvas.on('mouse:up', () => {
      if (!panningRef.current) return
      panningRef.current = false
      canvas.skipTargetFind = false
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

    return () => {
      observer.disconnect()
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      pendingMedia.forEach(({ controller }) => controller.abort())
      pendingMedia.clear()
      videoElements.forEach(releaseVideo)
      videoElements.clear()
      objectAssetUrls.clear()
      if (videoFrameRef.current !== undefined) cancelAnimationFrame(videoFrameRef.current)
      videoFrameRef.current = undefined
      nodeObjects.clear()
      artboardRef.current = null
      canvasRef.current = null
      void canvas.dispose()
    }
  }, [toggleVideo])

  useEffect(() => {
    const canvas = canvasRef.current
    const artboard = artboardRef.current
    if (!canvas || !artboard) return
    reconcilingObjectsRef.current = true

    artboard.set({ width: scene.width, height: scene.height })
    artboard.setCoords()

    const supportedNodes = scene.nodes
      .filter((node): node is ImageNode | VideoNode | GenerationNode => (
        node.type === 'image' || node.type === 'video' || node.type === 'generation'
      ))
      .slice()
      .sort((a, b) => a.zIndex - b.zIndex)
    const wantedNodeIds = new Set(supportedNodes.map((node) => node.id))
    wantedNodeIdsRef.current = wantedNodeIds
    nodesByIdRef.current = new Map(supportedNodes.map((node) => [node.id, node]))

    nodeObjectsRef.current.forEach((object, nodeId) => {
      if (wantedNodeIds.has(nodeId)) return
      canvas.remove(object)
      nodeObjectsRef.current.delete(nodeId)
      generationStatusesRef.current.delete(nodeId)
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

        const placeholder = createGenerationObject(node, status)
        generationStatusesRef.current.set(node.id, status)
        nodeObjectsRef.current.set(node.id, placeholder)
        objectNodeIdsRef.current.set(placeholder, node.id)
        canvas.add(placeholder)
        if (selectedNodeIdRef.current === node.id) canvas.setActiveObject(placeholder)
        return
      }

      const asset = assets[node.assetId]
      if (!asset || (node.type === 'image' && asset.type !== 'image') || (node.type === 'video' && asset.type !== 'video')) return

      if (existing instanceof FabricImage && objectAssetUrlsRef.current.get(node.id) === asset.url) {
        applyNodeToObject(existing, node)
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

      const pending = pendingMediaRef.current.get(node.id)
      if (pending?.assetUrl === asset.url) return
      pending?.controller.abort()

      const controller = new AbortController()
      pendingMediaRef.current.set(node.id, { assetUrl: asset.url, controller })
      const mediaPromise = asset.type === 'video'
        ? loadVideo(asset.url, controller.signal).then((video) => ({ object: new FabricImage(video), video }))
        : FabricImage.fromURL(asset.url, { crossOrigin: 'anonymous', signal: controller.signal })
          .then((image) => ({ object: image, video: undefined }))
      void mediaPromise
        .then(({ object, video }) => {
          if (!canvasRef.current || !wantedNodeIdsRef.current.has(node.id)) {
            if (video) releaseVideo(video)
            return
          }
          pendingMediaRef.current.delete(node.id)
          applyNodeToObject(object, node)
          nodeObjectsRef.current.set(node.id, object)
          objectAssetUrlsRef.current.set(node.id, asset.url)
          if (video) videoElementsRef.current.set(node.id, video)
          objectNodeIdsRef.current.set(object, node.id)
          canvas.add(object)
          reorderObjects()
          if (selectedNodeIdRef.current === node.id) canvas.setActiveObject(object)
          canvas.requestRenderAll()
          if (video) setVideoUiVersion((version) => version + 1)
        })
        .catch((error: unknown) => {
          pendingMediaRef.current.delete(node.id)
          if (controller.signal.aborted || reportedLoadErrorsRef.current.has(asset.url)) return
          reportedLoadErrorsRef.current.add(asset.url)
          const detail = error instanceof Error ? error.message : '未知错误'
          const mediaLabel = asset.type === 'video' ? '视频' : '图片'
          callbacksRef.current.onAssetLoadError(`${mediaLabel}“${asset.name}”加载失败：${detail}`)
        })
    })

    reorderObjects()
    canvas.requestRenderAll()
    reconcilingObjectsRef.current = false
  }, [assets, generations, scene.height, scene.nodes, scene.width, selectedNodeId])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    applyViewport(canvas, viewport)
    canvas.requestRenderAll()
  }, [viewport])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const activeObject = canvas.getActiveObject()
    const nextObject = selectedNodeId ? nodeObjectsRef.current.get(selectedNodeId) : undefined
    if (nextObject && activeObject !== nextObject) canvas.setActiveObject(nextObject)
    if (!nextObject && activeObject) canvas.discardActiveObject()
    canvas.requestRenderAll()
  }, [selectedNodeId, scene.nodes])

  const selectedNode = selectedNodeId
    ? scene.nodes.find((node) => node.id === selectedNodeId)
    : undefined
  const canDeleteSelected = !!selectedNode && selectedNode.type !== 'generation'
  const selectedVideo = selectedNode?.type === 'video'
    ? videoElementsRef.current.get(selectedNode.id)
    : undefined
  const selectedImage = selectedNode?.type === 'image' ? selectedNode : undefined
  const nodeActionPosition = selectedImage ? (() => {
    const bounds = calculateNodeBounds(selectedImage)
    const centerX = (bounds.left + bounds.right) / 2 * viewport.zoom + viewport.panX
    const top = bounds.top * viewport.zoom + viewport.panY
    const bottom = bounds.bottom * viewport.zoom + viewport.panY
    const preferredTop = top >= 52 ? top - 48 : bottom + 12
    return {
      left: `clamp(104px, ${centerX}px, calc(100% - 104px))`,
      top: `clamp(12px, ${preferredTop}px, calc(100% - 48px))`,
      transform: 'translateX(-50%)',
    }
  })() : undefined

  return (
    <div className="free-canvas-stage" ref={containerRef}>
      <canvas ref={canvasElementRef} aria-label="自由画布编辑区域" />
      {selectedImage && nodeActionPosition && (
        <div className="free-canvas-node-actions" style={nodeActionPosition} aria-label="图片派生操作">
          <Button
            size="small"
            type="text"
            icon={<BranchesOutlined />}
            disabled={generationActive}
            onClick={() => onNodeGenerationAction('variation', selectedImage.id)}
          >
            裂变
          </Button>
          <span className="free-canvas-node-actions-divider" />
          <Button
            size="small"
            type="text"
            icon={<VideoCameraAddOutlined />}
            disabled={generationActive}
            onClick={() => onNodeGenerationAction('image-to-video', selectedImage.id)}
          >
            生成视频
          </Button>
        </div>
      )}
      <div className="free-canvas-toolbar" aria-label="画布工具栏">
        <Tooltip title="撤销（⌘/Ctrl+Z）"><Button type="text" icon={<UndoOutlined />} disabled={!canUndo} onClick={onUndo} aria-label="撤销" /></Tooltip>
        <Tooltip title="重做（⇧⌘/Ctrl+Z）"><Button type="text" icon={<RedoOutlined />} disabled={!canRedo} onClick={onRedo} aria-label="重做" /></Tooltip>
        <span className="free-canvas-toolbar-divider" />
        <Tooltip title={selectedNode?.type === 'generation' ? '生成占位不能单独删除' : '删除所选节点'}><Button type="text" danger icon={<DeleteOutlined />} disabled={!canDeleteSelected} onClick={onDelete} aria-label="删除节点" /></Tooltip>
        {selectedNode?.type === 'video' && (
          <>
            <span className="free-canvas-toolbar-divider" />
            <Tooltip title={selectedVideo?.paused ? '播放视频' : '暂停视频'}>
              <Button
                type="text"
                icon={selectedVideo?.paused ? <CaretRightOutlined /> : <PauseOutlined />}
                disabled={!selectedVideo}
                onClick={() => { void toggleVideo(selectedNode.id) }}
                aria-label={selectedVideo?.paused ? '播放视频' : '暂停视频'}
              />
            </Tooltip>
            <Tooltip title={selectedVideo?.muted ? '取消静音' : '静音'}>
              <Button
                type="text"
                icon={selectedVideo?.muted ? <AudioMutedOutlined /> : <SoundOutlined />}
                disabled={!selectedVideo}
                onClick={() => toggleVideoMuted(selectedNode.id)}
                aria-label={selectedVideo?.muted ? '取消静音' : '静音'}
              />
            </Tooltip>
          </>
        )}
        <span className="free-canvas-toolbar-divider" />
        <Tooltip title="缩小"><Button type="text" icon={<MinusOutlined />} onClick={() => zoomBy(0.8)} aria-label="缩小画布" /></Tooltip>
        <span className="free-canvas-zoom-label">{Math.round(viewport.zoom * 100)}%</span>
        <Tooltip title="放大"><Button type="text" icon={<PlusOutlined />} onClick={() => zoomBy(1.25)} aria-label="放大画布" /></Tooltip>
        <Tooltip title="适合画板"><Button type="text" icon={<ExpandOutlined />} onClick={fitToScene} aria-label="适合画板" /></Tooltip>
      </div>
      <div className="free-canvas-help">滚轮平移 · ⌘/Ctrl + 滚轮缩放 · 空格拖动画布 · 双击视频播放/暂停</div>
    </div>
  )
})

export default FreeCanvasStage
