import { describe, expect, it } from 'vitest'
import { parseCreditsCommand } from './credits-args'

describe('积分管理参数', () => {
  it('保留原来的发放写法', () => {
    expect(parseCreditsCommand(['u1', 'production', '100', 'grant-1', '补发测试'])).toEqual({
      mode: 'grant', userId: 'u1', scope: 'production', value: 100, key: 'grant-1', reason: '补发测试',
    })
  })

  it('解析设余额和扣减', () => {
    expect(parseCreditsCommand(['--set', '0', 'u1', 'production', 'set-zero', '测 402'])).toEqual({
      mode: 'set', userId: 'u1', scope: 'production', value: 0, key: 'set-zero', reason: '测 402',
    })
    expect(parseCreditsCommand(['--amount', '-20', 'u1', 'preview', 'deduct-1', '压余额'])).toEqual({
      mode: 'delta', userId: 'u1', scope: 'preview', value: -20, key: 'deduct-1', reason: '压余额',
    })
  })

  it('缺少原因或非法金额时报用法', () => {
    expect(() => parseCreditsCommand(['--set', '0', 'u1', 'production', 'k'])).toThrow(/设余额/)
    expect(() => parseCreditsCommand(['--amount', '0', 'u1', 'production', 'k', '原因'])).toThrow(/增减/)
  })
})
