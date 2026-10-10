import { useLayoutEffect, useRef, useState } from 'react'

const PREVIEW_FOOTER_GAP = 18

/** 左栏必须能完整展示，才允许在桌面滚动容器内吸顶。 */
export function workstationPreviewFits(viewportHeight: number, previewHeight: number, footerHeight: number) {
  return [viewportHeight, previewHeight, footerHeight].every(Number.isFinite)
    && viewportHeight > 0 && previewHeight > 0 && footerHeight >= 0
    && previewHeight <= viewportHeight - footerHeight - PREVIEW_FOOTER_GAP
}

export function useStickyPreview(hasVisibleInput: boolean) {
  const previewRef = useRef<HTMLDivElement>(null)
  const footerRef = useRef<HTMLDivElement>(null)
  const [fits, setFits] = useState(false)

  useLayoutEffect(() => {
    const preview = previewRef.current
    const footer = footerRef.current
    const viewport = preview?.closest<HTMLElement>('.app-main-content')
    if (!hasVisibleInput || !preview || !footer || !viewport) return

    const desktop = window.matchMedia('(min-width: 901px)')
    const update = () => setFits(desktop.matches && workstationPreviewFits(
      viewport.clientHeight, preview.getBoundingClientRect().height, footer.getBoundingClientRect().height,
    ))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(viewport)
    observer.observe(preview)
    observer.observe(footer)
    desktop.addEventListener('change', update)
    return () => {
      observer.disconnect()
      desktop.removeEventListener('change', update)
    }
  }, [hasVisibleInput])

  return { previewRef, footerRef, sticky: hasVisibleInput && fits }
}
