import type { ImageAsset, ImageNode, ViewportState } from '@/editor/types'
import type { NodeTransform } from './types'

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 4
export const MIN_NODE_SIZE = 32
export const FIT_PADDING = 64
export const GENERATION_NODE_MAX_EDGE = 320
export const GENERATION_NODE_GAP = 32

export interface CanvasPoint {
  x: number
  y: number
}

export interface GenerationPlacement extends CanvasPoint {
  width: number
  height: number
}

export interface NodeBounds {
  left: number
  top: number
  right: number
  bottom: number
}

export function clampZoom(zoom: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

export function calculateFitViewport(
  container: { width: number; height: number },
  scene: { width: number; height: number },
  padding = FIT_PADDING,
): ViewportState {
  const availableWidth = Math.max(1, container.width - padding * 2)
  const availableHeight = Math.max(1, container.height - padding * 2)
  const zoom = clampZoom(Math.min(availableWidth / scene.width, availableHeight / scene.height))

  return {
    zoom,
    panX: (container.width - scene.width * zoom) / 2,
    panY: (container.height - scene.height * zoom) / 2,
  }
}

export function calculateInitialImageNode(
  asset: ImageAsset,
  scene: { id: string; width: number; height: number },
): ImageNode {
  const scale = Math.min(
    1,
    scene.width * 0.6 / asset.width,
    scene.height * 0.6 / asset.height,
  )
  const width = asset.width * scale
  const height = asset.height * scale

  return {
    id: crypto.randomUUID(),
    type: 'image',
    assetId: asset.id,
    name: asset.name,
    x: (scene.width - width) / 2,
    y: (scene.height - height) / 2,
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 0,
  }
}

export function calculateGenerationPlacements(
  center: CanvasPoint,
  size: { width: number; height: number },
  count: number,
): GenerationPlacement[] {
  const normalizedCount = Math.min(4, Math.max(1, Math.round(count)))
  const scale = Math.min(1, GENERATION_NODE_MAX_EDGE / Math.max(size.width, size.height))
  const width = size.width * scale
  const height = size.height * scale
  const columns = normalizedCount <= 2 ? normalizedCount : 2
  const rows = Math.ceil(normalizedCount / columns)
  const gridWidth = columns * width + (columns - 1) * GENERATION_NODE_GAP
  const gridHeight = rows * height + (rows - 1) * GENERATION_NODE_GAP

  return Array.from({ length: normalizedCount }, (_, index) => ({
    x: round(center.x - gridWidth / 2 + (index % columns) * (width + GENERATION_NODE_GAP)),
    y: round(center.y - gridHeight / 2 + Math.floor(index / columns) * (height + GENERATION_NODE_GAP)),
    width: round(width),
    height: round(height),
  }))
}

export function calculateNodeBounds(
  node: Pick<ImageNode, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
): NodeBounds {
  const radians = node.rotation * Math.PI / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const corners = [
    { x: 0, y: 0 },
    { x: node.width, y: 0 },
    { x: 0, y: node.height },
    { x: node.width, y: node.height },
  ].map((point) => ({
    x: node.x + point.x * cosine - point.y * sine,
    y: node.y + point.x * sine + point.y * cosine,
  }))
  return {
    left: round(Math.min(...corners.map((point) => point.x))),
    top: round(Math.min(...corners.map((point) => point.y))),
    right: round(Math.max(...corners.map((point) => point.x))),
    bottom: round(Math.max(...corners.map((point) => point.y))),
  }
}

export function calculateDerivedPlacements(
  source: Pick<ImageNode, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
  count: number,
): GenerationPlacement[] {
  const normalizedCount = Math.min(4, Math.max(1, Math.round(count)))
  const bounds = calculateNodeBounds(source)
  const columns = normalizedCount <= 2 ? normalizedCount : 2
  return Array.from({ length: normalizedCount }, (_, index) => ({
    x: round(bounds.right + GENERATION_NODE_GAP + (index % columns) * (source.width + GENERATION_NODE_GAP)),
    y: round(bounds.top + Math.floor(index / columns) * (source.height + GENERATION_NODE_GAP)),
    width: round(source.width),
    height: round(source.height),
  }))
}

export function normalizeNodeTransform(transform: NodeTransform): NodeTransform {
  return {
    x: round(transform.x),
    y: round(transform.y),
    width: round(Math.max(MIN_NODE_SIZE, transform.width)),
    height: round(Math.max(MIN_NODE_SIZE, transform.height)),
    rotation: round(((transform.rotation % 360) + 360) % 360),
  }
}

function round(value: number) {
  return Math.round(value * 100) / 100
}
