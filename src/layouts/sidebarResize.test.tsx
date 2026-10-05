// @vitest-environment jsdom

import { App } from 'antd'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MainLayout from '@/layouts/MainLayout'
import { readSidebarWidth, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN } from '@/features/preferences/storage'

function installMatchMedia(desktop: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: desktop ? String(query).includes('min-width: 768px') : String(query).includes('max-width: 720px'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }))
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
  })
})

function writeWidth(owner: string, width: number) {
  localStorage.setItem(`pixel:sidebar-width:v1:${window.location.origin}:${owner}`, String(width))
}
