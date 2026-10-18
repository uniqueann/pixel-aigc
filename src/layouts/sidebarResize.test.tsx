// @vitest-environment jsdom
import { QueryClient,QueryClientProvider } from '@tanstack/react-query'

import { App } from 'antd'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MainLayout from '@/layouts/MainLayout'
import { useThemeStore } from '@/store/useThemeStore'
import { useUserStore, type AccountContext } from '@/store/useUserStore'
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
    <QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})}><App>
      <MemoryRouter initialEntries={['/toolbox/bg-remove']}>
        <Routes>
          <Route path="/" element={<MainLayout />}>
            <Route path="toolbox/:tool" element={<div>工具箱页</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </App></QueryClientProvider>,
  )
}

describe('侧边栏拖拽', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
    document.body.classList.remove('sidebar-resizing')
    useUserStore.getState().setAccount(null)
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
    expect(document.querySelector('.app-brand-wordmark')).toBeTruthy()

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
    expect(document.querySelector('.app-brand-wordmark')).toBeNull()
    expect(document.querySelector('.app-sidebar-menu')?.className).toContain('ant-menu-inline-collapsed')
    expect(document.body.classList.contains('sidebar-resizing')).toBe(false)
    expect(readSidebarWidth('local')).toBe(SIDEBAR_WIDTH_MIN)

    fireEvent.doubleClick(screen.getByRole('separator', { name: '调整侧边栏宽度' }))
    expect(screen.getByRole('separator', { name: '调整侧边栏宽度' }).getAttribute('aria-valuenow')).toBe(String(SIDEBAR_WIDTH_MAX))
    expect(document.querySelector('.app-brand-wordmark')).toBeTruthy()
    expect(readSidebarWidth('local')).toBe(SIDEBAR_WIDTH_MAX)
  })

  it('手机端不渲染拖拽手柄，侧边栏保持收起', () => {
    installMatchMedia(false)
    renderLayout()
    expect(screen.queryByRole('separator', { name: '调整侧边栏宽度' })).toBeNull()
    expect(screen.getByRole('button', { name: '展开侧边栏' })).toBeTruthy()
    expect(document.querySelector('.app-brand-wordmark')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '展开侧边栏' }))
    expect(document.querySelector('.app-brand-wordmark')).toBeTruthy()
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
    expect(document.querySelector('.app-brand-wordmark')).toBeTruthy()
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
    expect(document.querySelector('.app-brand-wordmark')).toBeTruthy()
    expect(readSidebarState('local')).toBe(true)
  })

  it('移动端展开为浮动抽屉与遮罩，点击遮罩、关闭按钮、菜单项或按 ESC 均可收起', () => {
    installMatchMedia(false)
    renderLayout()
    const toggle = screen.getByRole('button', { name: '展开侧边栏' })
    expect(toggle.classList.contains('mobile-sidebar-toggle')).toBe(true)
    expect(document.querySelector('.app-sidebar-backdrop')).toBeNull()
    expect(document.querySelector('.app-sidebar.is-mobile-open')).toBeNull()

    // 点击展开
    fireEvent.click(toggle)
    expect(document.querySelector('.app-sidebar-backdrop')).toBeTruthy()
    expect(document.querySelector('.app-sidebar.is-mobile-open')).toBeTruthy()
    expect(document.querySelector('.app-brand-wordmark')).toBeTruthy()

    // 1. 点击遮罩收起
    fireEvent.click(document.querySelector('.app-sidebar-backdrop')!)
    expect(document.querySelector('.app-sidebar-backdrop')).toBeNull()
    expect(document.querySelector('.app-sidebar.is-mobile-open')).toBeNull()

    // 2. 再次展开并按 ESC 收起
    fireEvent.click(screen.getByRole('button', { name: '展开侧边栏' }))
    expect(document.querySelector('.app-sidebar.is-mobile-open')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.querySelector('.app-sidebar.is-mobile-open')).toBeNull()

    // 3. 再次展开并点击右上角收起按钮
    fireEvent.click(screen.getByRole('button', { name: '展开侧边栏' }))
    expect(document.querySelector('.app-sidebar.is-mobile-open')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '收起侧边栏' }))
    expect(document.querySelector('.app-sidebar.is-mobile-open')).toBeNull()

    // 4. 再次展开并点击导航菜单项，自动收起抽屉
    fireEvent.click(screen.getByRole('button', { name: '展开侧边栏' }))
    expect(document.querySelector('.app-sidebar.is-mobile-open')).toBeTruthy()
    fireEvent.click(screen.getByText('工作台首页'))
    expect(document.querySelector('.app-sidebar.is-mobile-open')).toBeNull()

    // 5. 再次展开并通过事件收起抽屉
    fireEvent.click(screen.getByRole('button', { name: '展开侧边栏' }))
    expect(document.querySelector('.app-sidebar.is-mobile-open')).toBeTruthy()
    act(() => {
      window.dispatchEvent(new CustomEvent('pixel-sidebar-collapse'))
    })
    expect(document.querySelector('.app-sidebar.is-mobile-open')).toBeNull()
  })

  it('电商套图在展开时于标题右侧显示新徽标，收起后徽标留在被隐藏的标题里', () => {
    installMatchMedia(true)
    useUserStore.getState().setAccount({
      userId: '11111111-1111-4111-8111-111111111111',
      features: { ecommerceSuite: true },
      credits: 0,
      email: 'suite@example.invalid',
      emailVerified: true,
      displayName: '测试',
      avatarUrl: null,
      providers: [],
      status: 'active',
      workspace: { id: 'w', name: '个人', type: 'personal', role: 'admin' },
    } satisfies AccountContext)
    renderLayout()
    const badge = screen.getByText('新')
    const item = screen.getByRole('menuitem', { name: /电商套图/ })
    expect(item.querySelector('.nav-item-badge')).toBe(badge)
    expect(badge.closest('.ant-menu-title-content')).toBeTruthy()
    expect(badge.compareDocumentPosition(item.querySelector('.nav-item-label-text')!)).toBe(Node.DOCUMENT_POSITION_PRECEDING)
    expect(document.querySelector('.app-sidebar-menu')?.className).not.toContain('ant-menu-inline-collapsed')

    fireEvent.click(screen.getByRole('button', { name: '收起侧边栏' }))
    const collapsed = document.querySelector('.app-sidebar-menu.ant-menu-inline-collapsed')
    const hidden = collapsed?.querySelector('.nav-item-badge')
    expect(hidden?.textContent).toBe('新')
    expect(hidden?.closest('.ant-menu-title-content')).toBeTruthy()
    expect(collapsed?.querySelector('.ant-menu-item .ant-menu-item-icon')).toBeTruthy()
  })

  it('左侧边栏与导航菜单跟随主题模式设置 theme', () => {
    installMatchMedia(true)
    act(() => {
      useThemeStore.getState().setMode('light')
    })
    const { unmount } = renderLayout()
    expect(document.querySelector('.app-sidebar.ant-layout-sider-light')).toBeTruthy()
    expect(document.querySelector('.app-sidebar-menu.ant-menu-light')).toBeTruthy()
    unmount()

    act(() => {
      useThemeStore.getState().setMode('dark')
    })
    renderLayout()
    expect(document.querySelector('.app-sidebar.ant-layout-sider-dark')).toBeTruthy()
    expect(document.querySelector('.app-sidebar-menu.ant-menu-dark')).toBeTruthy()
  })
})

function writeWidth(owner: string, width: number) {
  localStorage.setItem(`pixel:sidebar-width:v1:${window.location.origin}:${owner}`, String(width))
}
