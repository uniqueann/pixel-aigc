import { useEffect, useState, type RefObject } from 'react'

/** 吸顶卡是否已经贴住滚动容器顶部；留 1px 余量避免亚像素抖动。 */
export function previewIsStuck(scrollerTop: number, panelTop: number, scrollTop: number) {
  return scrollTop > 0 && panelTop <= scrollerTop + 1
}

/**
 * 移动端吸顶预览是否处于贴顶状态，用于切换紧凑条。
 * 同时把吸顶卡当前高度写入滚动容器的 `--workstation-sticky-height`，供滚动锚点使用。
 */
export function useStuckPreview(panelRef: RefObject<HTMLElement | null>, enabled = true) {
  const [stuck, setStuck] = useState(false)

  useEffect(() => {
    const panel = panelRef.current
    const scroller = panel?.closest<HTMLElement>('.app-main-content')
    if (!enabled || !panel || !scroller) return

    const mobile = window.matchMedia('(max-width: 560px)')
    // sticky 的 top: 0 落在滚动容器的内容盒顶部，需把内边距算进去。
    const paddingTop = Number.parseFloat(getComputedStyle(scroller).paddingTop) || 0
    let stickyHeight = 0
    const clearHeight = () => {
      if (stickyHeight === 0) return
      stickyHeight = 0
      scroller.style.removeProperty('--workstation-sticky-height')
    }
    const update = () => {
      if (!mobile.matches) {
        clearHeight()
        setStuck(current => current ? false : current)
        return
      }
      // 吸顶卡高度随工具与内容变化（完整卡 vs 紧凑条），滚动锚点必须跟着测量值走。
      const height = Math.ceil(panel.getBoundingClientRect().height)
      if (height > 0 && height !== stickyHeight) {
        stickyHeight = height
        scroller.style.setProperty('--workstation-sticky-height', `${height}px`)
      }
      const next = previewIsStuck(
        scroller.getBoundingClientRect().top + paddingTop,
        panel.getBoundingClientRect().top,
        scroller.scrollTop,
      )
      setStuck(current => current === next ? current : next)
    }
    update()
    // 结果条、步骤条等异步内容会改变卡片高度，用 ResizeObserver 补测。
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    observer?.observe(panel)
    scroller.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    mobile.addEventListener('change', update)
    return () => {
      observer?.disconnect()
      scroller.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      mobile.removeEventListener('change', update)
      clearHeight()
    }
  }, [enabled, panelRef])

  return enabled && stuck
}
