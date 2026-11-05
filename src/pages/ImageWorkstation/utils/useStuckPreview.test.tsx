// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { previewIsStuck, useStuckPreview } from './useStuckPreview'

function Preview({ enabled = true }: { enabled?: boolean }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const stuck = useStuckPreview(panelRef, enabled)
  return (
    <main className="app-main-content" data-testid="viewport">
      <div ref={panelRef} data-testid="panel" data-stuck={stuck}>预览</div>
    </main>
  )
}

describe('吸顶判定', () => {
  it.each([
    [0, 0, 0, false],
    [0, 0, 1, true],
    [0, 1, 100, true],
    [0, 2, 100, false],
    [0, -5, 100, true],
  ])('容器 %s、面板 %s、滚动 %s：贴顶 %s', (scrollerTop, panelTop, scrollTop, expected) => {
    expect(previewIsStuck(scrollerTop, panelTop, scrollTop)).toBe(expected)
  })
})

describe('吸顶状态观察', () => {
  let mobile = true
  let onMediaChange: () => void
  const removeEventListener = vi.fn()

  beforeEach(() => {
    mobile = true
    removeEventListener.mockClear()
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      get matches() { return mobile },
      addEventListener: (_event: string, callback: () => void) => { onMediaChange = callback },
      removeEventListener,
    })))
  })

  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('滚动到顶部后进入紧凑态，回滚或切到桌面后恢复', () => {
    render(<Preview />)
    const viewport = screen.getByTestId('viewport')
    const panel = screen.getByTestId('panel')
    expect(panel.dataset.stuck).toBe('false')

    viewport.scrollTop = 40
    fireEvent.scroll(viewport)
    expect(panel.dataset.stuck).toBe('true')

    viewport.scrollTop = 0
    fireEvent.scroll(viewport)
    expect(panel.dataset.stuck).toBe('false')

    viewport.scrollTop = 40
    fireEvent.scroll(viewport)
    mobile = false
    act(() => onMediaChange())
    expect(panel.dataset.stuck).toBe('false')
  })

  it('未启用时保持普通布局，并清理监听', () => {
    const { unmount } = render(<Preview enabled={false} />)
    const viewport = screen.getByTestId('viewport')
    viewport.scrollTop = 40
    fireEvent.scroll(viewport)
    expect(screen.getByTestId('panel').dataset.stuck).toBe('false')
    unmount()
    expect(removeEventListener).not.toHaveBeenCalled()
  })

  it('把吸顶卡实测高度写入滚动锚点变量，切到桌面或卸载时清理', () => {
    const { unmount } = render(<Preview />)
    const viewport = screen.getByTestId('viewport')
    const panel = screen.getByTestId('panel')
    const rect = (height: number) => ({
      x: 0, y: 0, width: 320, height, top: 0, left: 0, right: 320, bottom: height,
      toJSON: () => ({}),
    }) as DOMRect

    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(rect(432))
    fireEvent.scroll(viewport)
    expect(viewport.style.getPropertyValue('--workstation-sticky-height')).toBe('432px')

    mobile = false
    act(() => onMediaChange())
    expect(viewport.style.getPropertyValue('--workstation-sticky-height')).toBe('')

    mobile = true
    act(() => onMediaChange())
    expect(viewport.style.getPropertyValue('--workstation-sticky-height')).toBe('432px')

    unmount()
    expect(viewport.style.getPropertyValue('--workstation-sticky-height')).toBe('')
  })
})
