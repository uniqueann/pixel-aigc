import { i18n } from '@/i18n'

export type CapabilityAvailability = 'ready' | 'loading' | 'error' | 'soon'

/** 只有服务端确认关闭才展示即将上线，初次加载与请求失败单独呈现。 */
export function capabilityAvailability(ready: boolean | undefined, error?: unknown): CapabilityAvailability {
  if (ready === true) return 'ready'
  if (ready === false) return 'soon'
  return error ? 'error' : 'loading'
}

export function capabilityAvailabilityLabel(state: CapabilityAvailability): string {
  return {
    ready: '',
    loading: i18n.t('common:status.loading'),
    error: i18n.t('common:status.loadFailed'),
    soon: i18n.t('common:status.comingSoon'),
  }[state]
}
