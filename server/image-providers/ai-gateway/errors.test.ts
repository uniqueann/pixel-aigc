import { describe, expect, it } from 'vitest'
import { classifyAiGatewayFailure, clipGatewayLog, readGatewayFailure } from './errors.js'

describe('AI Gateway 错误映射', () => {
  it('402 与预算耗尽映射为余额不足', () => {
    expect(classifyAiGatewayFailure(402, { error: { message: 'Insufficient credits', type: 'insufficient_funds' } })).toMatchObject({
      code: 'INSUFFICIENT_BALANCE', message: '图片服务余额不足', retryable: false, status: 402,
    })
    expect(classifyAiGatewayFailure(402, { error: { message: 'budget exceeded', type: 'quota_for_entity_exceeded' } })).toMatchObject({
      code: 'INSUFFICIENT_BALANCE', status: 402,
    })
  })

  it('403 服务条款与核验要求映射为权限限制，不当成内容审核', () => {
    const terms = classifyAiGatewayFailure(403, {
      error: { message: 'The request is prohibited due to a violation of provider Terms Of Service.', type: 'permission_error' },
    })
    expect(terms).toMatchObject({ code: 'PROVIDER_FORBIDDEN', message: '图片服务暂不可用（上游权限限制）', retryable: false, status: 403 })
    expect(classifyAiGatewayFailure(403, {
      error: {
        message: 'AI Gateway requires a valid credit card on file to service requests.',
        type: 'customer_verification_required',
      },
    })).toMatchObject({ code: 'PROVIDER_FORBIDDEN', retryable: false })
  })

  it('免费层 no_providers_available 映射为余额，allowlist 映射为权限', () => {
    expect(classifyAiGatewayFailure(403, {
      error: {
        message: 'Free tier users do not have access to this model. Upgrade to paid credits.',
        type: 'no_providers_available',
      },
    })).toMatchObject({ code: 'INSUFFICIENT_BALANCE', message: '图片服务余额不足', retryable: false, status: 402 })
    expect(classifyAiGatewayFailure(403, {
      error: 'Your team has restricted access to this provider. Contact the owner of the account for more details.',
      type: 'no_providers_available',
    })).toMatchObject({ code: 'PROVIDER_FORBIDDEN', status: 403 })
  })

  it('明确的审核信号仍是内容拒绝，单独的 prohibited 不是', () => {
    expect(classifyAiGatewayFailure(400, { error: { message: 'content policy violation' } })).toMatchObject({
      code: 'CONTENT_REJECTED', message: '内容未通过审核', status: 400,
    })
    expect(classifyAiGatewayFailure(403, {
      error: { message: 'blocked', metadata: { reasons: ['SAFETY'] } },
    })).toMatchObject({ code: 'CONTENT_REJECTED' })
    expect(classifyAiGatewayFailure(400, { error: { message: 'request prohibited' } })).toMatchObject({
      code: 'INVALID_PARAMS',
    })
  })

  it('日志去掉密钥和令牌', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signaturevalue'
    const message = `denied Bearer ${jwt} sk-supersecretkey`
    const clipped = clipGatewayLog(message, ['gw-live-key-value'])
    expect(clipped).not.toContain(jwt)
    expect(clipped).not.toContain('sk-supersecretkey')
    expect(clipped).toContain('[redacted]')
    expect(readGatewayFailure({ error: { message: 'card required', type: 'customer_verification_required' } })).toEqual({
      message: 'card required', type: 'customer_verification_required',
    })
  })
})
