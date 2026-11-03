import type { AspectRatioSettings, BatchImage } from './types'

export interface AspectRatioSession {
  ownerId?: string
  items: BatchImage[]
  settings: AspectRatioSettings
  selectedId: string | null
}

let session: AspectRatioSession | null = null

/** 离开页面时仍在处理的图片按待处理恢复，避免回来后卡在处理中。 */
export function saveAspectRatioSession(next: AspectRatioSession) {
  session = {
    ...next,
    items: next.items.map(item => item.status === 'processing' ? { ...item, status: 'pending' } : item),
  }
}

export function loadAspectRatioSession(ownerId?: string) {
  return ownerId !== undefined && session?.ownerId !== ownerId ? null : session
}

export function clearAspectRatioSession() {
  session = null
}
