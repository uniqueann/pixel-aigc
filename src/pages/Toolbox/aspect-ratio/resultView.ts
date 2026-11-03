import type { BatchStatus, FitStrategy } from './types'

export type PreviewKind = 'result' | 'source' | 'processing' | 'failed' | 'pending'

/** 预览语义：处理中/失败不能被当成“已有转比例结果”。 */
export function previewKind({ mode, hasResult, status }: {
  mode: 'result' | 'source'
  hasResult: boolean
  status: BatchStatus
}): PreviewKind {
  if (mode === 'source') return 'source'
  if (status === 'processing') return 'processing'
  if (status === 'failed') return 'failed'
  if (hasResult) return 'result'
  return 'pending'
}

/** 结果预览优先，原图用于对照；没有结果时回退到原图。 */
export function previewSource(kind: PreviewKind, resultUrl: string | null, sourceUrl: string) {
  return kind === 'result' ? resultUrl ?? sourceUrl : sourceUrl
}

export function previewAlt(kind: PreviewKind, name: string) {
  if (kind === 'source') return `${name} 的原图`
  if (kind === 'processing') return `${name} 的原图，转比例处理中`
  if (kind === 'failed') return `${name} 的原图，未生成转比例结果`
  if (kind === 'pending') return `${name} 的原图，等待处理`
  return `${name} 的转比例结果`
}

export function previewMeta(kind: PreviewKind) {
  if (kind === 'source') return '原图'
  if (kind === 'processing') return '处理中'
  if (kind === 'failed') return '未生成结果'
  if (kind === 'pending') return '待处理'
  return '转比例结果'
}

/** 棋盘格只代表“已经生成的结果”，不能给源图或失败态套透明底。 */
export function showCheckerboard(kind: PreviewKind, strategy: FitStrategy, background: string) {
  return kind === 'result' && strategy === 'letterbox' && background === 'transparent'
}

export function previewOverlay(kind: PreviewKind) {
  if (kind === 'processing') return '正在转比例…'
  if (kind === 'failed') return '未生成结果，当前为原图'
  return null
}
