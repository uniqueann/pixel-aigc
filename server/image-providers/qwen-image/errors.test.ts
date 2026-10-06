import { describe, expect, it } from 'vitest'
import {
  QWEN_QUOTA_EXHAUSTED_MESSAGE,
  QWEN_THROTTLE_PENDING_MESSAGE,
  connectErrorLogFields,
  isPreSendConnectError,
  mapQwenFailure,
} from './errors.js'

describe('qwen image 错误映射', () => {
  it('内容审核和侵权不可重试', () => {
    expect(mapQwenFailure(400, 'DataInspectionFailed', 'inappropriate')).toMatchObject({
      code: 'CONTENT_REJECTED', message: '内容未通过审核', retryable: false,
    })
    expect(mapQwenFailure(400, 'InvalidParameter.DataInspection', '')).toMatchObject({ code: 'CONTENT_REJECTED', retryable: false })
    expect(mapQwenFailure(400, 'IPInfringementSuspect', '')).toMatchObject({
      code: 'CONTENT_REJECTED', message: '内容可能涉及侵权，无法生成', retryable: false,
    })
  })

  it('鉴权、欠费、限流和参数错误使用中文且限流可重试', () => {
    expect(mapQwenFailure(401, 'InvalidApiKey', 'Invalid API-key provided.')).toMatchObject({
      code: 'INVALID_KEY', message: '阿里云百炼 API Key 无效', retryable: false,
    })
    expect(mapQwenFailure(200, 'Arrearage', 'Access denied, overdue balance.')).toMatchObject({
      code: 'INSUFFICIENT_BALANCE', retryable: false,
    })
    expect(mapQwenFailure(429, 'Throttling.RateQuota', 'Requests rate limit exceeded.')).toMatchObject({
      code: 'RATE_LIMIT', message: QWEN_THROTTLE_PENDING_MESSAGE, retryable: true, holdPending: true,
    })
    expect(mapQwenFailure(429, 'Throttling', 'Requests throttling triggered.')).toMatchObject({
      holdPending: true, retryable: true,
    })
    expect(mapQwenFailure(429, 'Throttling.BurstRate', 'Request rate increased too quickly.')).toMatchObject({
      holdPending: true, retryable: true,
    })
    expect(mapQwenFailure(429, 'Throttling.AllocationQuota', 'Allocated quota exceeded, please increase your quota limit.')).toMatchObject({
      code: 'RATE_LIMIT', message: QWEN_QUOTA_EXHAUSTED_MESSAGE, retryable: false, holdPending: undefined,
    })
    expect(mapQwenFailure(429, 'Throttling.AllocationQuota', 'Free allocated quota exceeded.')).toMatchObject({
      retryable: false, holdPending: undefined,
    })
    expect(mapQwenFailure(400, 'InvalidParameter', 'size is invalid').retryable).toBe(false)
    expect(mapQwenFailure(500, 'InternalError', 'An internal error has occurred.').retryable).toBe(true)
    expect(mapQwenFailure(200, 'InternalError', 'An internal error has occurred.').retryable).toBe(false)
  })

  it('只有请求还没写出的建连失败才允许稍后重提', () => {
    const connectTimeout = new TypeError('fetch failed', {
      cause: Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT', name: 'ConnectTimeoutError' }),
    })
    const refused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    const reset = new TypeError('fetch failed', { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) })
    const bare = new TypeError('fetch failed')
    const aborted = new DOMException('The operation was aborted', 'AbortError')
    expect(isPreSendConnectError(connectTimeout)).toBe(true)
    expect(isPreSendConnectError(refused)).toBe(true)
    expect(isPreSendConnectError(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }))).toBe(true)
    expect(isPreSendConnectError(reset)).toBe(false)
    expect(isPreSendConnectError(bare)).toBe(false)
    expect(isPreSendConnectError(aborted)).toBe(false)
    expect(connectErrorLogFields(connectTimeout)).toMatchObject({
      error: 'fetch failed',
      errorName: 'TypeError',
      errorCode: 'UND_ERR_CONNECT_TIMEOUT',
      cause: 'ConnectTimeoutError: Connect Timeout Error',
    })
  })
})
