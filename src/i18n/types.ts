export type Locale = 'zh-CN' | 'en-US'

export const LOCALE_STORAGE_KEY = 'pixel:locale'

export const I18N_NAMESPACES = [
  'common',
  'nav',
  'auth',
  'settings',
  'errors',
  'credits',
  'taskCenter',
  'dashboard',
  'workstation',
  'toolbox',
  'ecommerce',
  'canvas',
  'email',
  'assets',
  'help',
] as const

export type I18nNamespace = (typeof I18N_NAMESPACES)[number]
