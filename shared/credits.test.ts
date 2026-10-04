import { describe, expect, it } from 'vitest'
import {
  CREDIT_KIND_LABELS,
  creditJobTitle,
  creditKindLabel,
  formatCreditDelta,
  insufficientCreditsMessage,
  mergeCreditJobEntries,
} from './credits'

describe('积分明细文案', () => {
  it('视频明细按模式、分辨率和秒数显示，不套用图片张数', () => {
    expect(creditJobTitle({ capability: 'text_to_video', params: { mode: 'text_to_video', durationSeconds: 5 }, resolution: '720p', count: 1 })).toBe('文生视频 720P 5秒')
    expect(creditJobTitle({ capability: 'text_to_video', params: { mode: 'image_to_video', durationSeconds: 10 }, resolution: '720p', count: 1 })).toBe('图生视频 720P 10秒')
  })
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

  it('同一任务的预扣和结算收成一行', () => {
    const settled = mergeCreditJobEntries([
      {
        id: 'r', kind: 'reserve', delta: -2, balanceAfter: 98, charged: null,
        createdAt: '2026-09-29T08:00:00.000Z', title: '精修 1K×1', reason: null,
      },
      {
        id: 's', kind: 'settle', delta: 0, balanceAfter: 98, charged: 2,
        createdAt: '2026-09-29T08:01:00.000Z', title: '精修 1K×1', reason: null,
      },
    ])
    expect(settled).toMatchObject({
      id: 's', label: '精修 1K×1', summary: '实扣 2', delta: -2, deltaText: '-2', balanceAfter: 98, charged: 2,
    })
    const settleLacksSpec = mergeCreditJobEntries([
      {
        id: 'r0', kind: 'reserve', delta: -2, balanceAfter: 98, charged: null,
        createdAt: '2026-09-29T07:00:00.000Z', title: '精修 1K×1', reason: null,
      },
      {
        id: 's0', kind: 'settle', delta: 0, balanceAfter: 98, charged: 2,
        createdAt: '2026-09-29T07:01:00.000Z', title: '精修', reason: null,
      },
    ])
    expect(settleLacksSpec.label).toBe('精修 1K×1')
    const partial = mergeCreditJobEntries([
      {
        id: 'r2', kind: 'reserve', delta: -6, balanceAfter: 94, charged: null,
        createdAt: '2026-09-29T09:00:00.000Z', title: '精修 2K×2', reason: null,
      },
      {
        id: 's2', kind: 'settle', delta: 3, balanceAfter: 97, charged: 3,
        createdAt: '2026-09-29T09:02:00.000Z', title: '精修 2K×2', reason: null,
      },
    ])
    expect(partial).toMatchObject({
      summary: '实扣 3, 已退回 3', delta: -3, deltaText: '-3', balanceAfter: 97,
    })
    const refunded = mergeCreditJobEntries([
      {
        id: 'r3', kind: 'reserve', delta: -2, balanceAfter: 98, charged: null,
        createdAt: '2026-09-29T10:00:00.000Z', title: '精修 1K×1', reason: null,
      },
      {
        id: 'f3', kind: 'refund', delta: 2, balanceAfter: 100, charged: 0,
        createdAt: '2026-09-29T10:03:00.000Z', title: '精修 1K×1', reason: null,
      },
    ])
    expect(refunded).toMatchObject({
      summary: '失败/超时已退款', delta: 0, deltaText: '0', balanceAfter: 100,
    })
    const pending = mergeCreditJobEntries([
      {
        id: 'r4', kind: 'reserve', delta: -2, balanceAfter: 98, charged: null,
        createdAt: '2026-09-29T11:00:00.000Z', title: '精修 1K×1', reason: null,
      },
    ])
    expect(pending).toMatchObject({
      summary: '处理中 预扣', delta: -2, deltaText: '-2', balanceAfter: 98,
    })
  })

  it('免费抠图的 0 分流水显示为免费，不显示扣 0 分', () => {
    const settled = mergeCreditJobEntries([{
      id: 'free-settle', kind: 'settle', delta: 0, balanceAfter: 30, charged: 0,
      createdAt: '2026-10-04T08:00:00.000Z', title: '免费抠图', reason: null,
    }])
    expect(settled).toMatchObject({ label: '免费抠图', summary: '本月免费额度', delta: 0, deltaText: '免费' })
    const refunded = mergeCreditJobEntries([{
      id: 'free-refund', kind: 'refund', delta: 0, balanceAfter: 30, charged: 0,
      createdAt: '2026-10-04T08:05:00.000Z', title: '免费抠图', reason: null,
    }])
    expect(refunded).toMatchObject({ label: '免费抠图', summary: '免费额度已退回', deltaText: '免费' })
  })
})
