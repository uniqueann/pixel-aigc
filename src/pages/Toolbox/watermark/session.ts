import type { BatchImage, WatermarkSettings } from './types'

export interface WatermarkSession {
  ownerId?: string
  items: BatchImage[]
  settings: WatermarkSettings
  selectedId: string | null
}

let session: WatermarkSession | null = null

/** 离开页面时仍在处理的图片按待处理恢复，避免回来后卡在处理中。 */
export function saveWatermarkSession(next: WatermarkSession) {
  session = {
    ...next,
    items: next.items.map(item => item.status === 'processing' ? { ...item, status: 'pending' } : item),
  }
}

export function loadWatermarkSession(ownerId?: string) {
  return ownerId !== undefined && session?.ownerId !== ownerId ? null : session
}

export function clearWatermarkSession() {
  session = null
}
