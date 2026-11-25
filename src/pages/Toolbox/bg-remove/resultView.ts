import { i18n } from '@/i18n'
import type { BatchStatus } from './types'

export type PreviewMode = 'result' | 'source'

/** 预览的语义状态：处理中/失败不能被当成“已有抠图结果”。 */
export type PreviewKind = 'result' | 'source' | 'processing' | 'failed' | 'pending'

export function previewKind({ mode, hasResult, status }: {
  mode: PreviewMode
  hasResult: boolean
  status: BatchStatus
}): PreviewKind {
  if (mode === 'source') return 'source'
  // 处理中或失败时，即使旧结果还在，也不能把主视觉描述成可交付结果。
  if (status === 'processing') return 'processing'
  if (status === 'failed') return 'failed'
  if (hasResult) return 'result'
  return 'pending'
}

/** 结果预览优先，原图用于对照；没有结果时回退到原图。 */
export function previewSource(mode: PreviewMode, resultUrl: string | null, sourceUrl: string) {
  return mode === 'source' ? sourceUrl : resultUrl ?? sourceUrl
}

export function previewAlt(kind: PreviewKind, name: string) {
  return i18n.t(`toolbox:bgRemove.previewAlt.${kind}`, { name })
}

export function previewMeta(kind: PreviewKind, backgroundMode: 'transparent' | 'color') {
  if (kind === 'result') return i18n.t(`toolbox:bgRemove.previewMeta.${backgroundMode}`)
  return i18n.t(`toolbox:bgRemove.previewMeta.${kind}`)
}

/** 棋盘格只代表“已经生成的结果”，不能给源图或失败态套透明底。 */
export function showCheckerboard(kind: PreviewKind, backgroundMode: 'transparent' | 'color') {
  return kind === 'result' && backgroundMode === 'transparent'
}

export function previewOverlay(kind: PreviewKind) {
  if (kind === 'processing') return i18n.t('toolbox:bgRemove.previewOverlay.processing')
  if (kind === 'failed') return i18n.t('toolbox:bgRemove.previewOverlay.failed')
  return null
}

export { resultStatusLabel } from '../shared/resultStatus'
export { footerMode, progressLabel, type FooterMode } from '../shared/resultProgress'
