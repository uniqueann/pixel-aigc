import { useMemo } from 'react'
import type { PreviewItem } from './PreviewGallery'
import { usePreviewGallery } from './usePreviewGallery'
import { useBlobUrls } from './useBlobUrls'

interface BlobPreviewSource {
  id: string
  file: File
  sourceUrl: string
  output?: Blob
}

export function useBlobPreviewGallery(items: BlobPreviewSource[]) {
  const blobs = useMemo(() => items.map(item => item.output), [items])
  const urls = useBlobUrls(blobs)
  const previewItems = useMemo<PreviewItem[]>(() => items.flatMap(item => item.output && urls.has(item.output) ? [{
    id: item.id,
    thumbSrc: item.sourceUrl,
    fullSrc: urls.get(item.output)!,
    originalSrc: item.sourceUrl,
    title: item.file.name,
  }] : []), [items, urls])
  return usePreviewGallery(previewItems)
}
