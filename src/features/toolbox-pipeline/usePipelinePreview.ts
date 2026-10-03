import { useEffect, useMemo, useState } from 'react'
import { PLATFORM_SIZE_PRESETS } from '@/constants/platformSizes'
import { AspectRatioRenderer } from '@/pages/Toolbox/aspect-ratio/renderer'
import { WatermarkRenderer } from '@/pages/Toolbox/watermark/renderer'
import { DEFAULT_WATERMARK_SETTINGS } from '@/pages/Toolbox/watermark/types'
import { hasWatermark } from '@/pages/Toolbox/watermark/validation'
import type { PipelineArtifact, PipelineItem, PipelineSettings } from './types'

export type PreviewStage = 'original' | 'ratio' | 'final'

export function usePipelinePreview(item: PipelineItem | undefined, settings: PipelineSettings, stage: PreviewStage, processing: boolean) {
  const sourceMime = item?.sourceMime
  const token = useMemo(() => ({ file: item?.file, intermediate: item?.intermediate, output: item?.output, settings, stage }),
    [item?.file, item?.intermediate, item?.output, settings, stage])
  const [preview, setPreview] = useState<{ token: typeof token; url?: string; loading: boolean; error?: string }>()
  useEffect(() => {
    if (!token.file || processing) return
    let cancelled = false
    let url: string | undefined
    const ratio = new AspectRatioRenderer()
    const watermark = new WatermarkRenderer()
    const renderThumbnail = (source: PipelineArtifact) => watermark.render({
      file: new File([source.blob], token.file!.name, { type: source.mimeType }), sourceMime: source.mimeType,
      settings: { ...DEFAULT_WATERMARK_SETTINGS }, outputMime: 'image/png', previewMaxDimension: 800,
    })
    const timer = window.setTimeout(() => {
      setPreview({ token, loading: true })
      void (async () => {
        if (stage === 'original') return watermark.render({ file: token.file!, sourceMime: sourceMime!, settings: { ...DEFAULT_WATERMARK_SETTINGS }, outputMime: 'image/png', previewMaxDimension: 800 })
        if (stage === 'final' && token.output) return renderThumbnail(token.output)
        const preset = PLATFORM_SIZE_PRESETS.find(preset => preset.id === settings.aspectRatio.selectedPresetId)!
        const intermediate = token.intermediate ? await renderThumbnail(token.intermediate) : await ratio.render({
          file: token.file!, settings: settings.aspectRatio, targetWidth: preset.width, targetHeight: preset.height,
          outputMime: 'image/png', previewMaxDimension: 800,
        })
        if (cancelled) return
        if (stage !== 'final' || !settings.watermarkEnabled || !hasWatermark(settings.watermark)) return intermediate
        return watermark.render({ file: new File([intermediate.blob], token.file!.name, { type: 'image/png' }),
          sourceMime: 'image/png', settings: settings.watermark, outputMime: 'image/png', previewMaxDimension: 800 })
      })().then(result => {
        if (!result || cancelled) return
        url = URL.createObjectURL(result.blob)
        setPreview({ token, url, loading: false })
      }).catch(error => {
        if (!cancelled) setPreview({ token, loading: false, error: error instanceof Error ? error.message : '预览失败' })
      }).finally(() => { ratio.dispose(); watermark.dispose() })
    }, 180)
    return () => { cancelled = true; window.clearTimeout(timer); ratio.dispose(); watermark.dispose(); if (url) URL.revokeObjectURL(url) }
  }, [token, settings, stage, processing, sourceMime])
  return preview?.token === token ? preview : undefined
}
