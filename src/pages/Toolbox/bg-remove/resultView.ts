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
  if (kind === 'source') return `${name} 原图`
  if (kind === 'processing') return `${name} 原图，抠图处理中`
  if (kind === 'failed') return `${name} 原图，未生成抠图结果`
  if (kind === 'pending') return `${name} 原图，等待处理`
  return `${name} 的抠图预览`
}

export function previewMeta(kind: PreviewKind, backgroundMode: 'transparent' | 'color') {
  if (kind === 'source') return '原图'
  if (kind === 'processing') return '处理中'
  if (kind === 'failed') return '未生成结果'
  if (kind === 'pending') return '待处理'
  return backgroundMode === 'transparent' ? '透明背景' : '纯色背景'
}

/** 棋盘格只代表“已经生成的结果”，不能给源图或失败态套透明底。 */
export function showCheckerboard(kind: PreviewKind, backgroundMode: 'transparent' | 'color') {
  return kind === 'result' && backgroundMode === 'transparent'
}

export function previewOverlay(kind: PreviewKind) {
  if (kind === 'processing') return '正在抠图…'
  if (kind === 'failed') return '未生成结果，当前为原图'
  return null
}

export function progressLabel({ itemCount, completedCount, failedCount, processing }: {
  itemCount: number
  completedCount: number
  failedCount: number
  processing: boolean
}) {
  if (itemCount === 0) return '尚未添加图片'
  // 处理中也要及时暴露失败数，避免失败项被“处理中”掩盖到批次结束。
  if (processing) {
    return failedCount > 0
      ? `${completedCount} / ${itemCount} 张已完成，${failedCount} 张失败`
      : `${completedCount} / ${itemCount} 张已完成`
  }
  if (failedCount > 0) return `${completedCount} / ${itemCount} 张已完成，${failedCount} 张失败`
  if (completedCount === itemCount) return `全部 ${itemCount} 张已完成，可打包下载`
  return `${completedCount} / ${itemCount} 张已完成`
}

/** 结果网格与徽标共用的状态文案。 */
export function resultStatusLabel(status: BatchStatus) {
  if (status === 'succeeded') return '完成'
  if (status === 'processing') return '处理中'
  if (status === 'failed') return '失败'
  return '等待'
}

export type FooterMode = 'cancel' | 'download' | 'retry' | 'empty' | 'process'

/** 底部主行动只保留一个：处理中取消、全部完成下载、有失败先重试。 */
export function footerMode({ processing, itemCount, allDone, failedCount }: {
  processing: boolean
  itemCount: number
  allDone: boolean
  failedCount: number
}): FooterMode {
  if (processing) return 'cancel'
  if (allDone) return 'download'
  if (failedCount > 0) return 'retry'
  if (itemCount === 0) return 'empty'
  return 'process'
}
