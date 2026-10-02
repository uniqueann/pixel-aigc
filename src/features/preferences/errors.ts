const RAW_NETWORK_ERROR = /failed to fetch|networkerror|network request failed|load failed|err_internet|err_network|err_connection|timeout|超时|the operation was aborted|aborterror/i

export function isLikelyNetworkError(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  return !raw.trim() || RAW_NETWORK_ERROR.test(raw)
}

export function preferenceUserMessage(error: unknown): string {
  if (typeof console !== 'undefined') console.error('个性化设置同步失败', error)
  if (isLikelyNetworkError(error)) return '网络异常，请检查网络后重试'
  const raw = error instanceof Error ? error.message.trim() : ''
  if (raw.includes('网络异常')) return '网络异常，请检查网络后重试'
  if (raw && /[一-龥]/.test(raw) && !RAW_NETWORK_ERROR.test(raw)) return raw
  return '同步失败，请稍后重试'
}

export function clearImageMemoryFailureMessage(error: unknown): string {
  if (typeof console !== 'undefined') console.error('清除图片参数记忆失败', error)
  const raw = error instanceof Error ? error.message : String(error ?? '')
  if (raw.includes('清除失败，网络异常')) return '清除失败，网络异常，请检查网络后重试'
  if (isLikelyNetworkError(error) || raw.includes('网络异常')) return '清除失败，网络异常，请检查网络后重试'
  return '清除图片参数记忆失败，请稍后重试'
}

export const CLEAR_IMAGE_MEMORY_SUCCESS_DURATION = 3
