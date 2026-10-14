// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyThemeToDom,
  getSystemTheme,
  readStoredThemeMode,
  resolveTheme,
  THEME_STORAGE_KEY,
  useThemeStore,
} from './useThemeStore'

describe('useThemeStore 外观主题状态管理', () => {
  const originalMatchMedia = window.matchMedia

  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
    document.documentElement.style.colorScheme = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.matchMedia = originalMatchMedia
    delete document.documentElement.dataset.theme
    document.documentElement.style.colorScheme = ''
  })

  it('读取持久化模式，未设置时默认为 system', () => {
    expect(readStoredThemeMode()).toBe('system')
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    expect(readStoredThemeMode()).toBe('dark')
    localStorage.setItem(THEME_STORAGE_KEY, 'light')
    expect(readStoredThemeMode()).toBe('light')
  })

  it('根据系统偏好解析 system 主题', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('dark'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    expect(getSystemTheme()).toBe('dark')
    expect(resolveTheme('system')).toBe('dark')

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: !query.includes('dark'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    expect(getSystemTheme()).toBe('light')
    expect(resolveTheme('system')).toBe('light')

    // 显式指定不受系统影响
    expect(resolveTheme('dark')).toBe('dark')
    expect(resolveTheme('light')).toBe('light')
  })

  it('applyThemeToDom 正确同步到 documentElement', () => {
    applyThemeToDom('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.style.colorScheme).toBe('light')

    applyThemeToDom('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('通过 setMode 切换模式并持久化至 localStorage 与 DOM', () => {
    useThemeStore.getState().setMode('light')
    expect(useThemeStore.getState().mode).toBe('light')
    expect(useThemeStore.getState().resolvedTheme).toBe('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')

    useThemeStore.getState().setMode('dark')
    expect(useThemeStore.getState().mode).toBe('dark')
    expect(useThemeStore.getState().resolvedTheme).toBe('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
