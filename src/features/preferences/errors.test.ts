import { describe, expect, it, vi } from 'vitest'
import { clearImageMemoryFailureMessage, isLikelyNetworkError, preferenceUserMessage } from './errors'

describe('偏好同步用户可见错误', () => {
  it('把 Failed to fetch 一类原始错误转成中文，并写入 console', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(isLikelyNetworkError(new TypeError('Failed to fetch'))).toBe(true)
    expect(preferenceUserMessage(new TypeError('Failed to fetch'))).toBe('网络异常，请检查网络后重试')
    expect(clearImageMemoryFailureMessage(new TypeError('Failed to fetch'))).toBe('清除失败，网络异常，请检查网络后重试')
    expect(clearImageMemoryFailureMessage(new Error('个性化设置尚未同步：网络异常，请检查网络后重试'))).toBe('清除失败，网络异常，请检查网络后重试')
    expect(preferenceUserMessage(new Error('账号已切换，请重新读取个性化设置'))).toBe('账号已切换，请重新读取个性化设置')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
