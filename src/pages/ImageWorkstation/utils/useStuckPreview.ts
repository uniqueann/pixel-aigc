import { useEffect, useState, type RefObject } from 'react'

/** 吸顶卡是否已经贴住滚动容器顶部；留 1px 余量避免亚像素抖动。 */
export function previewIsStuck(scrollerTop: number, panelTop: number, scrollTop: number) {
  return scrollTop > 0 && panelTop <= scrollerTop + 1
}

/** 移动端吸顶预览是否处于贴顶状态，用于切换紧凑条。 */
export function useStuckPreview(panelRef: RefObject<HTMLElement | null>, enabled = true) {
  const [stuck, setStuck] = useState(false)

  useEffect(() => {
    const panel = panelRef.current
    const scroller = panel?.closest<HTMLElement>('.app-main-content')
    if (!enabled || !panel || !scroller) return

    const mobile = window.matchMedia('(max-width: 560px)')
    // sticky 的 top: 0 落在滚动容器的内容盒顶部，需把内边距算进去。
    const paddingTop = Number.parseFloat(getComputedStyle(scroller).paddingTop) || 0
    const update = () => {
      const next = mobile.matches && previewIsStuck(
        scroller.getBoundingClientRect().top + paddingTop,
        panel.getBoundingClientRect().top,
        scroller.scrollTop,
      )
      setStuck(current => current === next ? current : next)
    }
    update()
    scroller.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    mobile.addEventListener('change', update)
    return () => {
      scroller.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      mobile.removeEventListener('change', update)
    }
  }, [enabled, panelRef])

  return enabled && stuck
}
