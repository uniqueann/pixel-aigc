import { useEffect, useMemo } from 'react'
import type { PreviewItem } from './PreviewGallery'
import { usePreviewGallery } from './usePreviewGallery'

interface BlobPreviewSource {
  id: string
  file: File
  sourceUrl: string
  output?: Blob
}

export function useBlobPreviewGallery(items: BlobPreviewSource[]) {
  const previewItems = useMemo<PreviewItem[]>(() => items.flatMap(item => item.output ? [{
    id: item.id,
    thumbSrc: item.sourceUrl,
    fullSrc: URL.createObjectURL(item.output),
    originalSrc: item.sourceUrl,
    title: item.file.name,
  }] : []), [items])
  useEffect(() => () => {
    for (const item of previewItems) URL.revokeObjectURL(item.fullSrc)
  }, [previewItems])
  return usePreviewGallery(previewItems)
}
