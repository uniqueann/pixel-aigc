import { describe, expect, it } from 'vitest'
import { dashScopeFailureText } from './dashscope'
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

  it('百炼 string index 不把 Python 原文回给用户', () => {
    expect(dashScopeFailureText('InvalidParameter', 'string index out of range', '消除')).toBe(
      '消除服务没有读到有效参数，请重新涂抹后重试',
    )
    expect(dashScopeFailureText('InvalidParameter', 'left_scale too large', '扩图')).toBe(
      '扩图参数超出服务限制：left_scale too large',
    )
  })
})
