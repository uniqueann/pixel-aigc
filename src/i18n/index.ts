import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { loadAntdEnUS } from './antdLocale'
import { I18N_NAMESPACES, type Locale } from './types'

import zhAssets from './locales/zh-CN/assets.json'
import zhAuth from './locales/zh-CN/auth.json'
import zhCanvas from './locales/zh-CN/canvas.json'
import zhCommon from './locales/zh-CN/common.json'
import zhCredits from './locales/zh-CN/credits.json'
import zhDashboard from './locales/zh-CN/dashboard.json'
import zhEcommerce from './locales/zh-CN/ecommerce.json'
import zhEmail from './locales/zh-CN/email.json'
import zhErrors from './locales/zh-CN/errors.json'
import zhHelp from './locales/zh-CN/help.json'
import zhNav from './locales/zh-CN/nav.json'
import zhSettings from './locales/zh-CN/settings.json'
import zhTaskCenter from './locales/zh-CN/taskCenter.json'
import zhToolbox from './locales/zh-CN/toolbox.json'
import zhWorkstation from './locales/zh-CN/workstation.json'

export const zhCNResources = {
  common: zhCommon,
  nav: zhNav,
  auth: zhAuth,
  settings: zhSettings,
  errors: zhErrors,
  credits: zhCredits,
  taskCenter: zhTaskCenter,
  dashboard: zhDashboard,
  workstation: zhWorkstation,
  toolbox: zhToolbox,
  ecommerce: zhEcommerce,
  canvas: zhCanvas,
  email: zhEmail,
  assets: zhAssets,
  help: zhHelp,
} as const

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    returnNull: false
    resources: typeof zhCNResources
  }
}

export const i18n = i18next.createInstance()

void i18n.use(initReactI18next).init({
  lng: 'zh-CN',
  fallbackLng: 'zh-CN',
  defaultNS: 'common',
  ns: [...I18N_NAMESPACES],
  resources: {
    'zh-CN': zhCNResources,
  },
  interpolation: {
    escapeValue: false,
  },
  returnNull: false,
  initAsync: false,
})

let enUsLoadPromise: Promise<void> | undefined

export async function ensureLocaleLoaded(locale: Locale): Promise<void> {
  if (locale === 'zh-CN') return
  if (!enUsLoadPromise) {
    enUsLoadPromise = Promise.all([
      import('./locales/en-US/common.json'),
      import('./locales/en-US/nav.json'),
      import('./locales/en-US/auth.json'),
      import('./locales/en-US/settings.json'),
      import('./locales/en-US/errors.json'),
      import('./locales/en-US/credits.json'),
      import('./locales/en-US/taskCenter.json'),
      import('./locales/en-US/dashboard.json'),
      import('./locales/en-US/workstation.json'),
      import('./locales/en-US/toolbox.json'),
      import('./locales/en-US/ecommerce.json'),
      import('./locales/en-US/canvas.json'),
      import('./locales/en-US/email.json'),
      import('./locales/en-US/assets.json'),
      import('./locales/en-US/help.json'),
      loadAntdEnUS(),
    ]).then(([
      common,
      nav,
      auth,
      settings,
      errors,
      credits,
      taskCenter,
      dashboard,
      workstation,
      toolbox,
      ecommerce,
      canvas,
      email,
      assets,
      help,
    ]) => {
      const bundles = {
        common,
        nav,
        auth,
        settings,
        errors,
        credits,
        taskCenter,
        dashboard,
        workstation,
        toolbox,
        ecommerce,
        canvas,
        email,
        assets,
        help,
      }
      for (const ns of I18N_NAMESPACES) {
        i18n.addResourceBundle('en-US', ns, bundles[ns].default, true, true)
      }
    }).catch((err) => {
      enUsLoadPromise = undefined
      throw err
    })
  }
  await enUsLoadPromise
}

export async function changeAppLocale(locale: Locale): Promise<void> {
  await ensureLocaleLoaded(locale)
  await i18n.changeLanguage(locale)
}

export const t = i18n.t.bind(i18n)
