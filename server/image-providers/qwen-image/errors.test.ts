import { describe, expect, it } from 'vitest'
import { mapQwenFailure } from './errors.js'

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
      code: 'RATE_LIMIT', message: '图片服务请求过于频繁，请稍后重试', retryable: true,
    })
    expect(mapQwenFailure(400, 'InvalidParameter', 'size is invalid').retryable).toBe(false)
    expect(mapQwenFailure(500, 'InternalError', 'An internal error has occurred.').retryable).toBe(true)
    expect(mapQwenFailure(200, 'InternalError', 'An internal error has occurred.').retryable).toBe(false)
  })
})
