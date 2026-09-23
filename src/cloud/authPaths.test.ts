import { describe, expect, it } from 'vitest'
import { safeNext } from './authPaths'

describe('登录后的返回地址', () => {
  it('只接受应用内业务路由', () => {
    const origin = 'https://aigc.contentup.cc'
    expect(safeNext('/canvas/text-to-image?project=one', origin)).toBe('/canvas/text-to-image?project=one')
    for (const target of ['https://example.com', '//example.com', '/\\example.com', '/login', '/auth/callback', '/%2F%2Fexample.com']) {
      expect(safeNext(target, origin)).toBe('/')
    }
  })
})
