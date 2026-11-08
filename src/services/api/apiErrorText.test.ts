import { describe, expect, it } from 'vitest'
import { apiErrorCode, apiErrorText, responseErrorText } from './apiErrorText'

describe('接口错误文案', () => {
  it('保留已有字符串，并去掉两端空白', () => {
    expect(apiErrorText('  请求内容过大  ')).toBe('请求内容过大')
    expect(responseErrorText({ error: '请先登录', code: 'AUTH_REQUIRED' })).toBe('请先登录')
  })

  it('对象错误只取嵌套 message，不带出其他字段', () => {
    const payload = {
      error: { message: '  原图对象无效  ', code: 'INVALID_SOURCE', token: 'secret-token', detail: { authorization: 'Bearer secret' } },
    }
    expect(responseErrorText(payload)).toBe('原图对象无效')
    expect(responseErrorText(payload)).not.toContain('secret')
    expect(apiErrorCode(payload)).toBe('INVALID_SOURCE')
  })

  it('没有可用 message 的对象、数组和空值都不变成 [object Object]', () => {
    expect(responseErrorText({ error: { code: 'X', token: 'secret-token' } })).toBeUndefined()
    expect(responseErrorText({ error: ['失败', { token: 'secret-token' }] })).toBeUndefined()
    expect(responseErrorText({ error: 413 })).toBeUndefined()
    expect(responseErrorText({ error: null })).toBeUndefined()
    expect(responseErrorText({ error: '' })).toBeUndefined()
    expect(responseErrorText({ error: '   ' })).toBeUndefined()
    expect(responseErrorText({ error: '[object Object]' })).toBeUndefined()
    expect(responseErrorText(null)).toBeUndefined()
    expect(responseErrorText('')).toBeUndefined()
    expect(responseErrorText({ error: { message: { token: 'secret-token' } } })).toBeUndefined()
  })

  it('顶层字符串 code 优先于嵌套 code', () => {
    expect(apiErrorCode({ code: 'REQUEST_FAILED', error: { code: 'NESTED' } })).toBe('REQUEST_FAILED')
    expect(apiErrorCode({ error: { code: 'INVALID_SOURCE' } })).toBe('INVALID_SOURCE')
    expect(apiErrorCode({ code: { token: 'secret-token' }, error: '请求内容过大' })).toBeUndefined()
    expect(apiErrorCode(null)).toBeUndefined()
  })
})
