import { describe, expect, it } from 'vitest'
import {
  CREDIT_KIND_LABELS,
  creditJobTitle,
  creditKindLabel,
  formatCreditDelta,
  insufficientCreditsMessage,
} from './credits'

describe('积分明细文案', () => {
  it('按流水类型给出中文标签，结算无退回时不叫退回', () => {
    expect(creditKindLabel('grant')).toBe('赠送/充值')
    expect(creditKindLabel('reserve')).toBe('提交预扣')
    expect(creditKindLabel('settle', 3)).toBe('结算退回')
    expect(creditKindLabel('settle', 0)).toBe('结算')
    expect(creditKindLabel('refund')).toBe('失败/超时退款')
    expect(creditKindLabel('adjust')).toBe('管理员调整')
    expect(CREDIT_KIND_LABELS.adjust).toBe('管理员调整')
  })

  it('从任务参数拼出工具名、分辨率和数量', () => {
    expect(creditJobTitle({
      params: { retouchDirections: ['blemish'] },
      capability: 'image_edit',
      resolution: '1k',
      count: 1,
    })).toBe('精修 1K×1')
    expect(creditJobTitle({
      params: { relight: { direction: 'top', quality: 'soft', temperature: 'cool' } },
      capability: 'image_edit',
      resolution: '2k',
      count: 1,
    })).toBe('重新打光 2K×1')
    expect(creditJobTitle({
      params: { referenceImageKey: 'temporary/task-inputs/u/scene.png' },
      capability: 'image_edit',
      resolution: '2k',
      count: 2,
    })).toBe('融合 2K×2')
    expect(creditJobTitle({ capability: 'variation', resolution: '4k', count: 2 })).toBe('裂变 4K×2')
    expect(creditJobTitle({ capability: 'image_edit', resolution: '2k', count: 1 })).toBe('智能编辑 2K×1')
  })

  it('余额不足文案带上所需和当前余额', () => {
    expect(insufficientCreditsMessage(6, 2)).toBe('积分余额不足：本次需要 6 积分，当前余额 2')
    expect(formatCreditDelta(5)).toBe('+5')
    expect(formatCreditDelta(-3)).toBe('-3')
    expect(formatCreditDelta(0)).toBe('0')
  })
})
