// @vitest-environment jsdom

import { App } from 'antd'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MainLayout from '@/layouts/MainLayout'
import { readSidebarState, readSidebarWidth, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN, writeSidebarState, writeSidebarWidth } from '@/features/preferences/storage'

function installMatchMedia(desktop: boolean) {
  let wide = desktop
  let narrow = !desktop
  const listeners = new Map<string, Set<(event: MediaQueryListEvent) => void>>()
  const matchesFor = (query: string) => query.includes('min-width: 768px') ? wide : query.includes('max-width: 720px') ? narrow : false
  vi.stubGlobal('matchMedia', (query: string) => {
    const bucket = listeners.get(query) ?? new Set<(event: MediaQueryListEvent) => void>()
    listeners.set(query, bucket)
    return {
      get matches() { return matchesFor(query) },
      media: query,
      addEventListener: (type: string, listener: (event: MediaQueryListEvent) => void) => { if (type === 'change') bucket.add(listener) },
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => { bucket.delete(listener) },
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }
  })
  return {
    set(next: { desktop?: boolean; narrow?: boolean }) {
      if (next.desktop !== undefined) wide = next.desktop
      if (next.narrow !== undefined) narrow = next.narrow
      for (const [query, bucket] of listeners) {
        const event = { matches: matchesFor(query), media: query } as MediaQueryListEvent
        for (const listener of bucket) listener(event)
      }
    },
  }
}

function renderLayout() {
  return render(
    <App>
      <MemoryRouter initialEntries={['/toolbox/bg-remove']}>
        <Routes>
          <Route path="/" element={<MainLayout />}>
            <Route path="toolbox/:tool" element={<div>工具箱页</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </App>,
  )
}

describe('侧边栏拖拽', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
    document.body.classList.remove('sidebar-resizing')
    vi.unstubAllGlobals()
  })

  it('电脑端可拖到图标宽度，方向键微调，双击恢复最宽并写入本地', () => {
    installMatchMedia(true)
    writeWidth('local', 200)
    renderLayout()
    const handle = screen.getByRole('separator', { name: '调整侧边栏宽度' })
    expect(handle.getAttribute('aria-valuenow')).toBe('200')
    expect(handle.getAttribute('aria-valuemin')).toBe(String(SIDEBAR_WIDTH_MIN))
    expect(handle.getAttribute('aria-valuemax')).toBe(String(SIDEBAR_WIDTH_MAX))
    expect(screen.getByText('Pixel AIGC')).toBeTruthy()

    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(screen.getByRole('separator', { name: '调整侧边栏宽度' }).getAttribute('aria-valuenow')).toBe('216')
    fireEvent.keyDown(screen.getByRole('separator', { name: '调整侧边栏宽度' }), { key: 'ArrowRight' })
    fireEvent.keyDown(screen.getByRole('separator', { name: '调整侧边栏宽度' }), { key: 'ArrowRight' })
    fireEvent.keyDown(screen.getByRole('separator', { name: '调整侧边栏宽度' }), { key: 'ArrowRight' })
    expect(screen.getByRole('separator', { name: '调整侧边栏宽度' }).getAttribute('aria-valuenow')).toBe(String(SIDEBAR_WIDTH_MAX))

    for (let step = 0; step < 20 && screen.getByRole('separator', { name: '调整侧边栏宽度' }).getAttribute('aria-valuenow') !== String(SIDEBAR_WIDTH_MIN); step += 1) {
      fireEvent.keyDown(screen.getByRole('separator', { name: '调整侧边栏宽度' }), { key: 'ArrowLeft' })
    }
    fireEvent.keyDown(screen.getByRole('separator', { name: '调整侧边栏宽度' }), { key: 'ArrowLeft' })
    expect(screen.getByRole('separator', { name: '调整侧边栏宽度' }).getAttribute('aria-valuenow')).toBe(String(SIDEBAR_WIDTH_MIN))
    expect(screen.queryByText('Pixel AIGC')).toBeNull()
    expect(document.querySelector('.app-sidebar-menu')?.className).toContain('ant-menu-inline-collapsed')
    expect(document.body.classList.contains('sidebar-resizing')).toBe(false)
    expect(readSidebarWidth('local')).toBe(SIDEBAR_WIDTH_MIN)

    fireEvent.doubleClick(screen.getByRole('separator', { name: '调整侧边栏宽度' }))
    expect(screen.getByRole('separator', { name: '调整侧边栏宽度' }).getAttribute('aria-valuenow')).toBe(String(SIDEBAR_WIDTH_MAX))
    expect(screen.getByText('Pixel AIGC')).toBeTruthy()
    expect(readSidebarWidth('local')).toBe(SIDEBAR_WIDTH_MAX)
  })

  it('手机端不渲染拖拽手柄，侧边栏保持收起', () => {
    installMatchMedia(false)
    renderLayout()
    expect(screen.queryByRole('separator', { name: '调整侧边栏宽度' })).toBeNull()
    expect(screen.getByRole('button', { name: '展开侧边栏' })).toBeTruthy()
    expect(screen.queryByText('Pixel AIGC')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '展开侧边栏' }))
    expect(screen.getByText('Pixel AIGC')).toBeTruthy()
    expect(screen.queryByRole('separator', { name: '调整侧边栏宽度' })).toBeNull()
    expect(readSidebarState('local')).toBeUndefined()
  })

  it('窄屏自动收起后回到宽屏，恢复账号保存的宽度和拖拽手柄', () => {
    writeSidebarState('local', true)
    writeSidebarWidth('local', 200)
    const media = installMatchMedia(true)
    renderLayout()
    expect(screen.getByRole('separator', { name: '调整侧边栏宽度' }).getAttribute('aria-valuenow')).toBe('200')

    act(() => media.set({ desktop: false, narrow: true }))
    expect(screen.queryByRole('separator', { name: '调整侧边栏宽度' })).toBeNull()
    expect(screen.getByRole('button', { name: '展开侧边栏' })).toBeTruthy()
    expect(document.querySelector('.ant-layout-sider-collapsed')).toBeTruthy()
    expect(readSidebarState('local')).toBe(true)
    writeSidebarWidth('local', 220)

    act(() => media.set({ desktop: false, narrow: false }))
    expect(screen.queryByRole('separator', { name: '调整侧边栏宽度' })).toBeNull()
    expect(screen.getByRole('button', { name: '展开侧边栏' })).toBeTruthy()

    act(() => media.set({ desktop: true, narrow: false }))
    expect(screen.getByRole('separator', { name: '调整侧边栏宽度' }).getAttribute('aria-valuenow')).toBe('220')
    expect(screen.getByText('Pixel AIGC')).toBeTruthy()
    expect(document.querySelector('.ant-layout-sider-collapsed')).toBeNull()
    expect(readSidebarState('local')).toBe(true)
    expect(readSidebarWidth('local')).toBe(220)
  })

  it('宽屏上手动收起后，放大仍然保持收起', () => {
    writeSidebarState('local', true)
    const media = installMatchMedia(true)
    renderLayout()
    fireEvent.click(screen.getByRole('button', { name: '收起侧边栏' }))
    expect(readSidebarState('local')).toBe(false)
    expect(screen.getByRole('button', { name: '展开侧边栏' })).toBeTruthy()

    act(() => media.set({ desktop: false, narrow: true }))
    act(() => media.set({ desktop: true, narrow: false }))
    expect(screen.getByRole('button', { name: '展开侧边栏' })).toBeTruthy()
    expect(screen.queryByRole('separator', { name: '调整侧边栏宽度' })).toBeNull()
    expect(readSidebarState('local')).toBe(false)
  })

  it('在窄屏刷新不会把自动收起当成账号偏好，变宽后仍恢复保存宽度', () => {
    writeSidebarState('local', true)
    writeSidebarWidth('local', 180)
    const media = installMatchMedia(false)
    const first = renderLayout()
    expect(screen.getByRole('button', { name: '展开侧边栏' })).toBeTruthy()
    expect(readSidebarState('local')).toBe(true)
    first.unmount()

    renderLayout()
    expect(readSidebarState('local')).toBe(true)
    expect(screen.queryByRole('separator', { name: '调整侧边栏宽度' })).toBeNull()
    act(() => media.set({ desktop: true, narrow: false }))
    expect(screen.getByRole('separator', { name: '调整侧边栏宽度' }).getAttribute('aria-valuenow')).toBe('180')
    expect(screen.getByText('Pixel AIGC')).toBeTruthy()
    expect(readSidebarState('local')).toBe(true)
  })
})

function writeWidth(owner: string, width: number) {
  localStorage.setItem(`pixel:sidebar-width:v1:${window.location.origin}:${owner}`, String(width))
}
