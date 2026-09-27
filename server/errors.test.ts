import { describe, expect, it } from 'vitest'
import { describeError, HttpError } from './errors'

describe('错误摘要', () => {
  it('展开 TypeError.cause 和 HttpError.stage', () => {
    const error = new HttpError(502, '无法连接', 'OUTPAINT_FAILED', {
      cause: new TypeError('fetch failed', { cause: new Error('Connect Timeout Error') }),
      stage: 'submit',
    })
    expect(describeError(error)).toMatchObject({
      name: 'HttpError',
      message: '无法连接',
      cause: 'TypeError: fetch failed (Error: Connect Timeout Error)',
      stage: 'submit',
    })
  })
})
