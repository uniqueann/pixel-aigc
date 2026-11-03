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
  if (mode === 'source') return `${name} 原图`
  return hasResult ? `${name} 的水印结果` : `${name} 的水印预览`
}

export function watermarkPreviewMeta({ mode, hasResult }: { mode: WatermarkPreviewMode; hasResult: boolean }) {
  if (mode === 'source') return '原图'
  return hasResult ? '水印结果' : '水印预览'
}
