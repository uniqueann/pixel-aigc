import type { ViewportState } from '@/editor/types'
import { clampZoom } from './geometry'

export interface TouchPoint {
  x: number
  y: number
}

export function midpoint(a: TouchPoint, b: TouchPoint): TouchPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

export function distance(a: TouchPoint, b: TouchPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

interface PinchOptions {
  /** 手势开始时的视口 */
  viewport: ViewportState
  startDistance: number
  distance: number
  /** 双指中心（画布坐标，相对 canvas 左上角） */
  startMid: TouchPoint
  mid: TouchPoint
}

/**
 * 双指捏合：按两指距离变化缩放，并让手势开始时中心下的画板内容始终跟着当前中心，
 * 因此同一次手势里既能缩放也能双指平移。
 */
export function pinchViewport({ viewport, startDistance, distance: currentDistance, startMid, mid }: PinchOptions): ViewportState {
  const ratio = startDistance > 0 ? currentDistance / startDistance : 1
  const zoom = clampZoom(viewport.zoom * ratio)
  const scene = {
    x: (startMid.x - viewport.panX) / viewport.zoom,
    y: (startMid.y - viewport.panY) / viewport.zoom,
  }
  return {
    zoom,
    panX: round(mid.x - scene.x * zoom),
    panY: round(mid.y - scene.y * zoom),
  }
}

function round(value: number) {
  return Math.round(value * 100) / 100
}
