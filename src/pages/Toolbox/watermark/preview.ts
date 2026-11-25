import { i18n } from '@/i18n'

export type WatermarkPreviewMode = 'result' | 'source'

interface PreviewSourceArgs {
  mode: WatermarkPreviewMode
  resultUrl?: string | null
  previewUrl?: string | null
  sourceUrl: string
}

/** 结果模式优先用已导出的结果，其次是实时预览；原图模式始终用源图。 */
export function watermarkPreviewSource({ mode, resultUrl, previewUrl, sourceUrl }: PreviewSourceArgs) {
  if (mode === 'source') return sourceUrl
  return resultUrl ?? previewUrl ?? sourceUrl
}

interface PreviewAltArgs {
  mode: WatermarkPreviewMode
  name: string
  hasResult: boolean
}

/** alt 必须跟随当前展示的内容，避免把原图描述成水印结果。 */
export function watermarkPreviewAlt({ mode, name, hasResult }: PreviewAltArgs) {
  if (mode === 'source') return i18n.t('toolbox:watermark.previewAlt.source', { name })
  return hasResult
    ? i18n.t('toolbox:watermark.previewAlt.result', { name })
    : i18n.t('toolbox:watermark.previewAlt.preview', { name })
}

export function watermarkPreviewMeta({ mode, hasResult }: { mode: WatermarkPreviewMode; hasResult: boolean }) {
  if (mode === 'source') return i18n.t('toolbox:watermark.previewMeta.source')
  return hasResult
    ? i18n.t('toolbox:watermark.previewMeta.result')
    : i18n.t('toolbox:watermark.previewMeta.preview')
}
