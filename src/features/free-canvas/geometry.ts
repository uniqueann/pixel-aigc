import type { ImageAsset, ImageNode, ViewportState } from '@/editor/types'
import type { NodeTransform } from './types'

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 4
export const MIN_NODE_SIZE = 32
export const FIT_PADDING = 64
export const GENERATION_NODE_MAX_EDGE = 320
export const GENERATION_NODE_GAP = 32
export const NODE_CASCADE_OFFSET = 40

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

export function unionBounds(items: NodeBounds[]): NodeBounds | undefined {
  if (!items.length) return undefined
  return {
    left: Math.min(...items.map(item => item.left)),
    top: Math.min(...items.map(item => item.top)),
    right: Math.max(...items.map(item => item.right)),
    bottom: Math.max(...items.map(item => item.bottom)),
  }
}

export function boundsFromPlacement(placement: GenerationPlacement): NodeBounds {
  return {
    left: placement.x,
    top: placement.y,
    right: placement.x + placement.width,
    bottom: placement.y + placement.height,
  }
}

export function overlapsBounds(a: NodeBounds, b: NodeBounds, padding = 0) {
  return a.left < b.right + padding
    && a.right + padding > b.left
    && a.top < b.bottom + padding
    && a.bottom + padding > b.top
}

export function offsetPlacementToAvoidOverlap(
  placement: GenerationPlacement,
  occupied: NodeBounds[],
  options: { offset?: number; maxAttempts?: number } = {},
): GenerationPlacement {
  const offset = options.offset ?? NODE_CASCADE_OFFSET
  const maxAttempts = options.maxAttempts ?? 24
  let next = { ...placement }
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const bounds = boundsFromPlacement(next)
    if (!occupied.some(item => overlapsBounds(bounds, item))) return next
    next = { ...next, x: round(next.x + offset), y: round(next.y + offset) }
  }
  return next
}

function gridOrigin(source: NodeBounds, item: { width: number; height: number }, columns: number, rows: number) {
  const gridWidth = columns * item.width + (columns - 1) * GENERATION_NODE_GAP
  const gridHeight = rows * item.height + (rows - 1) * GENERATION_NODE_GAP
  return [
    { x: source.right + GENERATION_NODE_GAP, y: source.top },
    { x: source.left, y: source.bottom + GENERATION_NODE_GAP },
    { x: source.left - GENERATION_NODE_GAP - gridWidth, y: source.top },
    { x: source.left, y: source.top - GENERATION_NODE_GAP - gridHeight },
  ]
}

function placementsFromOrigin(
  origin: CanvasPoint,
  count: number,
  columns: number,
  size: { width: number; height: number },
): GenerationPlacement[] {
  return Array.from({ length: count }, (_, index) => ({
    x: round(origin.x + (index % columns) * (size.width + GENERATION_NODE_GAP)),
    y: round(origin.y + Math.floor(index / columns) * (size.height + GENERATION_NODE_GAP)),
    width: size.width,
    height: size.height,
  }))
}

function fitsScene(placements: GenerationPlacement[], scene: { width: number; height: number }) {
  return placements.every(item => (
    item.x >= 0
    && item.y >= 0
    && item.x + item.width <= scene.width
    && item.y + item.height <= scene.height
  ))
}

function clampPlacementToScene(placement: GenerationPlacement, scene: { width: number; height: number }): GenerationPlacement {
  const width = Math.min(placement.width, scene.width)
  const height = Math.min(placement.height, scene.height)
  return {
    x: round(Math.min(Math.max(0, placement.x), Math.max(0, scene.width - width))),
    y: round(Math.min(Math.max(0, placement.y), Math.max(0, scene.height - height))),
    width: round(width),
    height: round(height),
  }
}

export function calculateDerivedPlacements(
  source: Pick<ImageNode, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
  count: number,
  options: { scene?: { width: number; height: number }; occupied?: NodeBounds[] } = {},
): GenerationPlacement[] {
  const normalizedCount = Math.min(4, Math.max(1, Math.round(count)))
  const bounds = calculateNodeBounds(source)
  const size = { width: round(source.width), height: round(source.height) }
  const columns = normalizedCount <= 2 ? normalizedCount : 2
  const rows = Math.ceil(normalizedCount / columns)
  const candidates = gridOrigin(bounds, size, columns, rows)
    .map(origin => placementsFromOrigin(origin, normalizedCount, columns, size))
  const preferred = options.scene
    ? candidates.find(item => fitsScene(item, options.scene!)) ?? candidates[0].map(item => clampPlacementToScene(item, options.scene!))
    : candidates[0]
  if (!options.occupied?.length && !options.scene) return preferred
  const occupied = [...(options.occupied ?? [])]
  return preferred.map((placement) => {
    const next = offsetPlacementToAvoidOverlap(placement, occupied)
    occupied.push(boundsFromPlacement(next))
    return options.scene ? clampPlacementToScene(next, options.scene) : next
  })
}

export function calculateRevealViewport(
  container: { width: number; height: number },
  targets: NodeBounds[],
  current?: ViewportState,
  padding = FIT_PADDING,
): ViewportState {
  const union = unionBounds(targets)
  if (!union) return current ?? { zoom: 1, panX: 0, panY: 0 }
  const width = Math.max(1, union.right - union.left)
  const height = Math.max(1, union.bottom - union.top)
  const availableWidth = Math.max(1, container.width - padding * 2)
  const availableHeight = Math.max(1, container.height - padding * 2)
  const fitZoom = clampZoom(Math.min(availableWidth / width, availableHeight / height))
  const zoom = current && width * current.zoom <= availableWidth && height * current.zoom <= availableHeight
    ? current.zoom
    : fitZoom
  if (current) {
    const view = {
      left: (padding - current.panX) / current.zoom,
      top: (padding - current.panY) / current.zoom,
      right: (container.width - padding - current.panX) / current.zoom,
      bottom: (container.height - padding - current.panY) / current.zoom,
    }
    if (union.left >= view.left && union.top >= view.top && union.right <= view.right && union.bottom <= view.bottom) {
      return current
    }
  }
  return {
    zoom,
    panX: round((container.width - width * zoom) / 2 - union.left * zoom),
    panY: round((container.height - height * zoom) / 2 - union.top * zoom),
  }
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
