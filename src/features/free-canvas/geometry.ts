import type { ImageAsset, ImageNode, ViewportState } from '@/editor/types'
import type { NodeTransform } from './types'

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 4
export const MIN_NODE_SIZE = 32
export const FIT_PADDING = 64

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
