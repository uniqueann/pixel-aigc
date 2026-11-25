import { create } from 'zustand'
import { applyLocaleToDom, readStoredLocale } from './detect'
import { changeAppLocale } from './index'
import { LOCALE_STORAGE_KEY, type Locale } from './types'

interface LocaleStoreState {
  locale: Locale
  ready: boolean
  setLocale: (locale: Locale) => Promise<void>
}

const initialLocale = readStoredLocale()
applyLocaleToDom(initialLocale)

let transitionSeq = 0

export const useLocaleStore = create<LocaleStoreState>((set) => ({
  locale: initialLocale,
  ready: initialLocale === 'zh-CN',
  setLocale: async (locale: Locale) => {
    const seq = ++transitionSeq
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale)
    } catch {
      // 忽略存储受限
    }
    await changeAppLocale(locale)
    if (seq !== transitionSeq) return
    applyLocaleToDom(locale)
    set({ locale, ready: true })
  },
}))

if (initialLocale === 'en-US') {
  const bootSeq = transitionSeq
  void changeAppLocale('en-US')
    .then(() => {
      if (bootSeq !== transitionSeq) return
      applyLocaleToDom('en-US')
      useLocaleStore.setState({ locale: 'en-US', ready: true })
    })
    .catch(() => {
      if (bootSeq !== transitionSeq) return
      applyLocaleToDom('zh-CN')
      useLocaleStore.setState({ locale: 'zh-CN', ready: true })
    })
}
