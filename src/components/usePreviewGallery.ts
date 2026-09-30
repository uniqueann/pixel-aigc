import { useCallback, useState } from 'react'
import type { PreviewGalleryProps, PreviewItem } from './PreviewGallery'

export function usePreviewGallery(items: PreviewItem[]) {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState(0)
  const openAt = useCallback((id: string) => {
    const index = items.findIndex(item => item.id === id)
    if (index < 0) return
    setCurrent(index)
    setOpen(true)
  }, [items])
  const galleryProps: PreviewGalleryProps = {
    items,
    open,
    current: Math.min(current, Math.max(0, items.length - 1)),
    onClose: () => setOpen(false),
    onChange: setCurrent,
  }
  return { openAt, galleryProps }
}
