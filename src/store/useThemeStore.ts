import { create } from 'zustand'

export type ThemeMode = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'

export const THEME_STORAGE_KEY = 'pixel:theme-mode'

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'dark'
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') return getSystemTheme()
  return mode
}

export function applyThemeToDom(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = resolved
  document.documentElement.style.colorScheme = resolved
}

export function readStoredThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system'
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'dark' || stored === 'light' || stored === 'system') {
      return stored
    }
  } catch {
    // 忽略 localStorage 访问受限异常
  }
  return 'system'
}

interface ThemeStoreState {
  mode: ThemeMode
  resolvedTheme: ResolvedTheme
  setMode: (mode: ThemeMode) => void
  syncSystemTheme: () => void
}

const initialMode = readStoredThemeMode()
const initialResolved = resolveTheme(initialMode)
applyThemeToDom(initialResolved)

export const useThemeStore = create<ThemeStoreState>((set, get) => ({
  mode: initialMode,
  resolvedTheme: initialResolved,
  setMode: (mode: ThemeMode) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode)
    } catch {
      // 忽略存储受限
    }
    const resolved = resolveTheme(mode)
    applyThemeToDom(resolved)
    set({ mode, resolvedTheme: resolved })
  },
  syncSystemTheme: () => {
    const { mode } = get()
    if (mode === 'system') {
      const resolved = getSystemTheme()
      applyThemeToDom(resolved)
      set({ resolvedTheme: resolved })
    }
  },
}))

if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  try {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      useThemeStore.getState().syncSystemTheme()
    }
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handler)
    } else if (typeof (mediaQuery as unknown as { addListener?: (fn: () => void) => void }).addListener === 'function') {
      (mediaQuery as unknown as { addListener: (fn: () => void) => void }).addListener(handler)
    }
  } catch {
    // 忽略不支持场景
  }
}
