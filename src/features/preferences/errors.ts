import { i18n } from '@/i18n'
import { activeLocale } from '@/i18n/format'

const RAW_NETWORK_ERROR = /failed to fetch|networkerror|network request failed|load failed|err_internet|err_network|err_connection|timeout|\u8d85\u65f6|the operation was aborted|aborterror/i
const CJK_RE = /[\u4e00-\u9fff]/

export function isLikelyNetworkError(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  return !raw.trim() || RAW_NETWORK_ERROR.test(raw)
}

export function preferenceUserMessage(error: unknown): string {
  if (typeof console !== 'undefined') console.error('Failed to sync preferences', error)
  if (isLikelyNetworkError(error)) return i18n.t('settings:personalization.syncErrors.network')
  const raw = error instanceof Error ? error.message.trim() : ''
  const networkMsg = i18n.t('settings:personalization.syncErrors.network')
  if (raw.includes(networkMsg)) return networkMsg
  if (raw && !RAW_NETWORK_ERROR.test(raw) && (activeLocale() === 'zh-CN' || !CJK_RE.test(raw))) return raw
  return i18n.t('settings:personalization.syncErrors.generic')
}

export function clearImageMemoryFailureMessage(error: unknown): string {
  if (typeof console !== 'undefined') console.error('Failed to clear image parameter memory', error)
  const raw = error instanceof Error ? error.message : String(error ?? '')
  const clearNetworkMsg = i18n.t('settings:personalization.syncErrors.clearNetwork')
  const networkMsg = i18n.t('settings:personalization.syncErrors.network')
  if (raw.includes(clearNetworkMsg) || isLikelyNetworkError(error) || raw.includes(networkMsg)) {
    return clearNetworkMsg
  }
  return i18n.t('settings:personalization.syncErrors.clearGeneric')
}

export const CLEAR_IMAGE_MEMORY_SUCCESS_DURATION = 3
