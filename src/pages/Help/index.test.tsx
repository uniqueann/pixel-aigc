// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Help from '@/pages/Help'
import { HELP_ARTICLES } from '@/pages/Help/articles'
import { useThemeStore } from '@/store/useThemeStore'

vi.stubGlobal('matchMedia', (query: string) => ({
  matches: false,
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
}))

function renderHelp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/help/:article" element={<Help />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('帮助中心', () => {
  afterEach(() => {
    cleanup()
    useThemeStore.getState().setMode('system')
  })

  it('左侧目录列出全部文章', () => {
    renderHelp('/help/quickstart')
    for (const article of HELP_ARTICLES) {
      expect(screen.getByRole('menuitem', { name: article.title })).toBeTruthy()
    }
  })

  it('按路由渲染对应文章内容', () => {
    renderHelp('/help/credits')
    expect(screen.getByRole('heading', { name: '积分与计费说明' })).toBeTruthy()
    // 文章正文来自 markdown：出现计费关键句
    expect(screen.getByText(/只按实际成功的张数结算/)).toBeTruthy()
  })

  it('渲染电商套图使用指南并包含关键步骤', () => {
    renderHelp('/help/ecommerce-suite')
    expect(screen.getByRole('heading', { name: '电商套图使用指南' })).toBeTruthy()
    expect(screen.getByText(/完整业务流程/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: '第五步：合规预检与成品导出' })).toBeTruthy()
  })

  it('未知 slug 回退到第一篇', () => {
    renderHelp('/help/not-exist')
    expect(screen.getByRole('heading', { name: HELP_ARTICLES[0].title })).toBeTruthy()
  })

  it('文章正文渲染表格与代码块', () => {
    renderHelp('/help/workstation')
    // workstation.md 含工具对照表与代码块
    expect(document.querySelector('.help-article table')).toBeTruthy()
    renderHelp('/help/quickstart')
    expect(document.querySelector('.help-article pre')).toBeTruthy()
  })

  it('侧边栏与菜单跟随主题模式适配', () => {
    act(() => {
      useThemeStore.getState().setMode('light')
    })
    const { unmount } = renderHelp('/help/quickstart')
    expect(document.querySelector('.help-sider.ant-layout-sider-light')).toBeTruthy()
    expect(document.querySelector('.help-menu.ant-menu-light')).toBeTruthy()
    unmount()

    act(() => {
      useThemeStore.getState().setMode('dark')
    })
    renderHelp('/help/quickstart')
    expect(document.querySelector('.help-sider.ant-layout-sider-dark')).toBeTruthy()
    expect(document.querySelector('.help-menu.ant-menu-dark')).toBeTruthy()
  })

  it('样式表包含折叠触发按钮样式与主题变量定义', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/pages/Help/help.css'), 'utf8')
    expect(css).toContain('.help-sider .ant-layout-sider-zero-width-trigger')
    expect(css).toContain('var(--color-surface)')
    expect(css).toContain('var(--color-text-primary)')
    expect(css).toContain('var(--color-border)')
  })
})
