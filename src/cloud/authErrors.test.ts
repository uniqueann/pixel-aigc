import { describe, expect, it, vi } from 'vitest'
import { authErrorMessage } from './authErrors'

describe('authErrorMessage', () => {
  it('按错误码映射常见登录错误', () => {
    const error = Object.assign(new Error('Invalid login credentials'), { code: 'invalid_credentials' })
    expect(authErrorMessage(error, '兜底文案')).toBe('邮箱或密码不正确，请检查后重试，或使用“忘记密码”。')
  })

  it('没有 code 时按英文文案兜底匹配', () => {
    expect(authErrorMessage(new Error('Invalid login credentials'), '兜底文案')).toContain('邮箱或密码不正确')
  })

  it('保留项目自己抛出的中文校验信息', () => {
    expect(authErrorMessage(new Error('恢复会话已失效，请重新申请密码重置邮件'), '兜底文案'))
      .toBe('恢复会话已失效，请重新申请密码重置邮件')
  })

  it('未知错误返回操作兜底，并把原始错误留在控制台', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(authErrorMessage(new Error('Something odd'), '登录失败，请稍后重试。')).toBe('登录失败，请稍后重试。')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
