// @vitest-environment jsdom

import { App } from 'antd'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MainLayout from '@/layouts/MainLayout'

function installMatchMedia(narrow: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: narrow && query.includes('720px'),
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
      <MemoryRouter initialEntries={['/image-workstation/smart-edit']}>
        <Routes>
          <Route path="/" element={<MainLayout />}>
            <Route path="image-workstation/:tool" element={<div>工作站页</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </App>,
  )
}

describe('顶栏账号入口', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it.each([false, true])('窄屏 %s 时齿轮打开与侧栏相同的账号菜单，并可进入设置', async (narrow) => {
    installMatchMedia(narrow)
    renderLayout()
    expect(screen.getByRole('button', { name: '账号与设置' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '账号与设置' }))
    const menuItem = (name: string) => {
      const element = [...document.querySelectorAll('.account-dropdown [role="menuitem"]')].find(item => item.textContent?.replace(/\s+/g, '') === name)
      if (!element) throw new Error(`未找到菜单项 ${name}`)
      return element
    }
    expect(menuItem('个性化')).toBeTruthy()
    expect(menuItem('帮助与支持')).toBeTruthy()
    expect(menuItem('退出登录')).toBeTruthy()
    fireEvent.click(menuItem('设置'))
    expect(await screen.findByText('调整界面显示和常用体验。')).toBeTruthy()
  })
})
