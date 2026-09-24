import type { BatchImage, BgRemoveSettings } from './types'

export interface BgRemoveSession {
  items: BatchImage[]
  settings: BgRemoveSettings
  selectedId: string | null
}

export interface EdgeRefineHandoff {
  itemId: string
  file: File
  matte: Blob
  width: number
  height: number
}

export interface EdgeRefineResult {
  itemId: string
  matte: Blob | null
  cancelled: boolean
}

let session: BgRemoveSession | null = null
let handoff: EdgeRefineHandoff | null = null
let result: EdgeRefineResult | null = null

export function saveBgRemoveSession(next: BgRemoveSession) {
  session = {
    ...next,
    items: next.items.map(item => item.status === 'processing' ? { ...item, status: 'pending' } : item),
  }
}

export function loadBgRemoveSession() {
  return session
}

export function clearBgRemoveSession() {
  session = null
}

export function setEdgeRefineHandoff(next: EdgeRefineHandoff) {
  handoff = next
}

export function takeEdgeRefineHandoff() {
  const current = handoff
  handoff = null
  return current
}

export function clearEdgeRefineHandoff() {
  handoff = null
}

export function setEdgeRefineResult(next: EdgeRefineResult) {
  result = next
}

export function takeEdgeRefineResult() {
  const current = result
  result = null
  return current
}

export function applyEdgeRefineResult(items: BatchImage[], next: EdgeRefineResult | null) {
  if (!next || next.cancelled || !next.matte) return items
  return items.map(item => item.id === next.itemId
    ? { ...item, matte: next.matte!, output: undefined, outputMime: undefined }
    : item)
}
