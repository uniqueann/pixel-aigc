// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStickyPreview, workstationPreviewFits } from './useStickyPreview'

function Preview({ hasInput }: { hasInput: boolean }) {
  const { previewRef, footerRef, sticky } = useStickyPreview(hasInput)
  return <main className="app-main-content" data-testid="viewport">
    <div ref={previewRef} data-testid="preview" data-sticky={sticky}>画布</div>
    <div ref={footerRef} data-testid="footer">生成</div>
  </main>
}

describe('工作站预览可用高度', () => {
  it.each([
    [700, 582, 100, true],
    [700, 583, 100, false],
    [500, 400, 100, false],
    [0, 400, 100, false],
    [700, 0, 100, false],
    [700, 400, -1, false],
    [NaN, 400, 100, false],
    [700, Infinity, 100, false],
  ])('视口 %s、左栏 %s、操作条 %s：可吸顶 %s', (viewport, preview, footer, expected) => {
    expect(workstationPreviewFits(viewport, preview, footer)).toBe(expected)
  })
})

describe('工作站预览尺寸观察', () => {
  let onResize: () => void
  let onMediaChange: () => void
  let desktop: boolean
  let viewportHeight: number
  let previewHeight: number
  let footerHeight: number
  const observe = vi.fn()
  const disconnect = vi.fn()
  const removeEventListener = vi.fn()

  beforeEach(() => {
    desktop = true
    viewportHeight = 800
    previewHeight = 500
    footerHeight = 80
    observe.mockClear()
    disconnect.mockClear()
    removeEventListener.mockClear()
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      get matches() { return desktop },
      addEventListener: (_event: string, callback: () => void) => { onMediaChange = callback },
      removeEventListener,
    })))
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { onResize = callback }
      observe = observe
      disconnect = disconnect
    })
  })

  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  function measure() {
    Object.defineProperty(screen.getByTestId('viewport'), 'clientHeight', { configurable: true, get: () => viewportHeight })
    for (const [id, height] of [['preview', () => previewHeight], ['footer', () => footerHeight]] as const) {
      screen.getByTestId(id).getBoundingClientRect = () => ({
        x: 0, y: 0, top: 0, left: 0, right: 640, bottom: height(), width: 640, height: height(), toJSON: () => ({}),
      })
    }
    act(() => onResize())
  }

  it('图片、操作条或视口增高后重新判断，窄屏恢复普通滚动', () => {
    render(<Preview hasInput />)
    measure()
    expect(observe.mock.calls.map(([element]) => element.dataset.testid)).toEqual(['viewport', 'preview', 'footer'])
    expect(screen.getByTestId('preview').dataset.sticky).toBe('true')
    previewHeight = 750
    act(() => onResize())
    expect(screen.getByTestId('preview').dataset.sticky).toBe('false')
    previewHeight = 500
    footerHeight = 300
    act(() => onResize())
    expect(screen.getByTestId('preview').dataset.sticky).toBe('false')
    viewportHeight = 900
    act(() => onResize())
    expect(screen.getByTestId('preview').dataset.sticky).toBe('true')
    desktop = false
    act(() => onMediaChange())
    expect(screen.getByTestId('preview').dataset.sticky).toBe('false')
  })

  it('隐藏输入后立即取消吸顶并清理观察，恢复输入时重新测量', () => {
    const { rerender, unmount } = render(<Preview hasInput />)
    measure()
    expect(screen.getByTestId('preview').dataset.sticky).toBe('true')
    rerender(<Preview hasInput={false} />)
    expect(screen.getByTestId('preview').dataset.sticky).toBe('false')
    expect(disconnect).toHaveBeenCalledOnce()
    expect(removeEventListener).toHaveBeenCalledWith('change', onMediaChange)
    previewHeight = 750
    rerender(<Preview hasInput />)
    expect(screen.getByTestId('preview').dataset.sticky).toBe('false')
    unmount()
    expect(disconnect).toHaveBeenCalledTimes(2)
  })
})
