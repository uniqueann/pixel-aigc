import { i18n } from '@/i18n'
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
  return i18n.t(`toolbox:aspectRatio.previewAlt.${kind}`, { name })
}

export function previewMeta(kind: PreviewKind) {
  return i18n.t(`toolbox:aspectRatio.previewMeta.${kind}`)
}

/** 棋盘格只代表“已经生成的结果”，不能给源图或失败态套透明底。 */
export function showCheckerboard(kind: PreviewKind, strategy: FitStrategy, background: string) {
  return kind === 'result' && strategy === 'letterbox' && background === 'transparent'
}

export function previewOverlay(kind: PreviewKind) {
  if (kind === 'processing') return i18n.t('toolbox:aspectRatio.previewOverlay.processing')
  if (kind === 'failed') return i18n.t('toolbox:aspectRatio.previewOverlay.failed')
  return null
}
