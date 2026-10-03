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

/** 新节点与画板边缘、已有节点之间优先保留的间距（画板坐标）。 */
export const ARTBOARD_PLACEMENT_GAP = 24
const ARTBOARD_PLACEMENT_GAPS = [ARTBOARD_PLACEMENT_GAP, 16, 0]
const ARTBOARD_FIT_SCALES = [0.85, 0.7, 0.55, 0.4, 0.3, 0.2]

function separatedFrom(placement: GenerationPlacement, occupied: NodeBounds[], gap = ARTBOARD_PLACEMENT_GAP) {
  const bounds = boundsFromPlacement(placement)
  return !occupied.some(item => overlapsBounds(bounds, item, gap))
}

function insideArtboard(placement: GenerationPlacement, scene: { width: number; height: number }, gap = ARTBOARD_PLACEMENT_GAP) {
  return placement.width > 0
    && placement.height > 0
    && placement.x >= gap
    && placement.y >= gap
    && placement.x + placement.width <= scene.width - gap
    && placement.y + placement.height <= scene.height - gap
}

function placementKey(placement: GenerationPlacement) {
  return `${placement.x}|${placement.y}|${placement.width}|${placement.height}`
}

function distanceToCenter(placement: GenerationPlacement, center: CanvasPoint) {
  const dx = placement.x + placement.width / 2 - center.x
  const dy = placement.y + placement.height / 2 - center.y
  return dx * dx + dy * dy
}

function pushCoord(coords: number[], value: number, min: number, max: number) {
  const next = round(value)
  if (next >= min - 0.001 && next <= max + 0.001) coords.push(Math.min(max, Math.max(min, next)))
}

/**
 * 在画板内缘留出间距后，收集首选点、网格和贴边空位。
 * 贴边坐标保证：只要存在不重叠的空位，候选里就一定有一个。
 */
function slotCandidates(
  preferred: GenerationPlacement,
  size: { width: number; height: number },
  occupied: NodeBounds[],
  scene: { width: number; height: number },
  anchor: NodeBounds | undefined,
  gap: number,
) {
  const width = round(size.width)
  const height = round(size.height)
  const minX = gap
  const minY = gap
  const maxX = round(scene.width - gap - width)
  const maxY = round(scene.height - gap - height)
  if (width < 1 || height < 1 || maxX < minX || maxY < minY) return []

  const origin = {
    x: preferred.x + (preferred.width - width) / 2,
    y: preferred.y + (preferred.height - height) / 2,
  }
  const raw: GenerationPlacement[] = []
  const seen = new Set<string>()
  const push = (x: number, y: number) => {
    if (x < minX - 0.001 || y < minY - 0.001 || x > maxX + 0.001 || y > maxY + 0.001) return
    const placement = { x: round(Math.min(maxX, Math.max(minX, x))), y: round(Math.min(maxY, Math.max(minY, y))), width, height }
    const key = placementKey(placement)
    if (seen.has(key)) return
    seen.add(key)
    raw.push(placement)
  }

  push(origin.x, origin.y)
  push(Math.min(Math.max(minX, origin.x), maxX), Math.min(Math.max(minY, origin.y), maxY))

  const step = Math.max(16, gap)
  for (let iy = 0; iy < 10000; iy += 1) {
    const y = round(Math.min(minY + iy * step, maxY))
    for (let ix = 0; ix < 10000; ix += 1) {
      const x = round(Math.min(minX + ix * step, maxX))
      push(x, y)
      if (minX + ix * step >= maxX - 0.001) break
    }
    if (minY + iy * step >= maxY - 0.001) break
  }

  const xs = [minX, maxX]
  const ys = [minY, maxY]
  pushCoord(xs, origin.x, minX, maxX)
  pushCoord(ys, origin.y, minY, maxY)
  for (const box of anchor ? [anchor, ...occupied] : occupied) {
    pushCoord(xs, box.right + gap, minX, maxX)
    pushCoord(xs, box.left - gap - width, minX, maxX)
    pushCoord(xs, box.left, minX, maxX)
    pushCoord(xs, box.right - width, minX, maxX)
    pushCoord(ys, box.bottom + gap, minY, maxY)
    pushCoord(ys, box.top - gap - height, minY, maxY)
    pushCoord(ys, box.top, minY, maxY)
    pushCoord(ys, box.bottom - height, minY, maxY)
  }
  for (const x of xs) for (const y of ys) push(x, y)

  const center = { x: preferred.x + preferred.width / 2, y: preferred.y + preferred.height / 2 }
  return raw.sort((a, b) => distanceToCenter(a, center) - distanceToCenter(b, center) || a.y - b.y || a.x - b.x)
}

function findFreeSlot(
  preferred: GenerationPlacement,
  size: { width: number; height: number },
  occupied: NodeBounds[],
  scene: { width: number; height: number },
  anchor: NodeBounds | undefined,
  gap: number,
) {
  return slotCandidates(preferred, size, occupied, scene, anchor, gap)
    .find(item => insideArtboard(item, scene, gap) && separatedFrom(item, occupied, gap))
}

function placeOutsideArtboard(
  preferred: GenerationPlacement,
  occupied: NodeBounds[],
  scene: { width: number; height: number },
): GenerationPlacement {
  const width = round(preferred.width)
  const height = round(preferred.height)
  const gap = ARTBOARD_PLACEMENT_GAP
  const below = offsetPlacementToAvoidOverlap({
    x: round(Math.min(Math.max(0, preferred.x), Math.max(0, scene.width - width))),
    y: round(scene.height + gap),
    width,
    height,
  }, occupied, { offset: gap, padding: gap, maxAttempts: 64 })
  if (separatedFrom(below, occupied, 0)) return below
  const union = unionBounds(occupied)
  const beside = {
    x: round((union?.right ?? scene.width) + gap),
    y: round(Math.max(0, preferred.y)),
    width,
    height,
  }
  const cleared = offsetPlacementToAvoidOverlap(beside, occupied, { offset: gap, padding: gap, maxAttempts: 64 })
  if (separatedFrom(cleared, occupied, 0)) return cleared
  return { x: round((union?.right ?? scene.width) + gap), y: round(scene.height + gap), width, height }
}

/**
 * 先贴近首选点（视口中心或源节点旁）寻找画板内、互不重叠的空位。
 * 原尺寸放不下时按既有比例缩小；仍然没有空位才放到画板外并避开已有内容。
 * `outside` 为真时调用方应平移视口把新节点露出来。
 */
export function findArtboardPlacement(
  preferred: GenerationPlacement,
  occupied: NodeBounds[],
  scene: { width: number; height: number },
  anchor?: NodeBounds,
): GenerationPlacement & { outside: boolean } {
  for (const gap of ARTBOARD_PLACEMENT_GAPS) {
    const found = findFreeSlot(preferred, preferred, occupied, scene, anchor, gap)
    if (found) return { ...found, outside: false }
  }
  for (const scale of ARTBOARD_FIT_SCALES) {
    const size = { width: round(preferred.width * scale), height: round(preferred.height * scale) }
    if (size.width < MIN_NODE_SIZE || size.height < MIN_NODE_SIZE) continue
    for (const gap of ARTBOARD_PLACEMENT_GAPS) {
      const fitted = findFreeSlot(preferred, size, occupied, scene, anchor, gap)
      if (fitted) return { ...fitted, outside: false }
    }
  }
  return { ...placeOutsideArtboard(preferred, occupied, scene), outside: true }
}

function shiftGroupInside(
  placements: GenerationPlacement[],
  scene: { width: number; height: number },
  gap: number,
) {
  if (!placements.length) return []
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const item of placements) {
    minX = Math.min(minX, item.x)
    minY = Math.min(minY, item.y)
    maxX = Math.max(maxX, item.x + item.width)
    maxY = Math.max(maxY, item.y + item.height)
  }
  const innerWidth = scene.width - gap * 2
  const innerHeight = scene.height - gap * 2
  if (maxX - minX > innerWidth + 0.001 || maxY - minY > innerHeight + 0.001) return undefined
  let dx = 0
  let dy = 0
  if (minX < gap) dx = gap - minX
  else if (maxX > scene.width - gap) dx = scene.width - gap - maxX
  if (minY < gap) dy = gap - minY
  else if (maxY > scene.height - gap) dy = scene.height - gap - maxY
  return placements.map(item => ({ ...item, x: round(item.x + dx), y: round(item.y + dy) }))
}

function groupFits(
  placements: GenerationPlacement[],
  occupied: NodeBounds[],
  scene: { width: number; height: number },
  gap: number,
) {
  const taken = [...occupied]
  return placements.every((placement) => {
    if (!insideArtboard(placement, scene, gap) || !separatedFrom(placement, taken, gap)) return false
    taken.push(boundsFromPlacement(placement))
    return true
  })
}

/** 按原顺序把一批节点放进画板。能整组平移进去时保持相对位置，否则逐个寻找空位。 */
export function placeArtboardNodes(
  preferred: GenerationPlacement[],
  occupied: NodeBounds[],
  scene: { width: number; height: number },
  anchor?: NodeBounds,
): GenerationPlacement[] {
  for (const gap of ARTBOARD_PLACEMENT_GAPS) {
    const shifted = shiftGroupInside(preferred, scene, gap)
    if (shifted && groupFits(shifted, occupied, scene, gap)) return shifted
  }
  const taken = [...occupied]
  return preferred.map((placement) => {
    const next = findArtboardPlacement(placement, taken, scene, anchor)
    const stored = { x: next.x, y: next.y, width: next.width, height: next.height }
    taken.push(boundsFromPlacement(stored))
    return stored
  })
}

export function offsetPlacementToAvoidOverlap(
  placement: GenerationPlacement,
  occupied: NodeBounds[],
  options: { offset?: number; maxAttempts?: number; padding?: number } = {},
): GenerationPlacement {
  const offset = options.offset ?? NODE_CASCADE_OFFSET
  const maxAttempts = options.maxAttempts ?? 24
  const padding = options.padding ?? 0
  let next = { ...placement }
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const bounds = boundsFromPlacement(next)
    if (!occupied.some(item => overlapsBounds(bounds, item, padding))) return next
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
  if (!options.scene) {
    const occupied = [...(options.occupied ?? [])]
    return preferred.map((placement) => {
      const next = offsetPlacementToAvoidOverlap(placement, occupied)
      occupied.push(boundsFromPlacement(next))
      return next
    })
  }
  return placeArtboardNodes(preferred, [...(options.occupied ?? []), bounds], options.scene, bounds)
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
