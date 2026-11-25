import { describe, expect, it } from 'vitest'
import { parseLedgerCursor, presentCreditLedgerRow } from './credits.js'

describe('积分明细展示', () => {
  it('分页游标必须是时间与流水 id', () => {
    expect(parseLedgerCursor(null)).toBeUndefined()
    expect(() => parseLedgerCursor('bad')).toThrow(/分页参数无效/)
    expect(parseLedgerCursor('2026-09-29T10:00:00.000Z|00000000-0000-4000-8000-000000000123')).toEqual({
      createdAt: '2026-09-29T10:00:00.000Z',
      id: '00000000-0000-4000-8000-000000000123',
    })
  })

  it('结算行带上工具、分辨率，供合并时取标题', () => {
    const row = presentCreditLedgerRow({
      id: '00000000-0000-4000-8000-000000000201',
      kind: 'settle',
      delta: 1,
      balance_after: 98,
      charged: 2,
      meta: { capability: 'image_edit', resolution: '1k', unitPrice: 2 },
      reason: null,
      created_at: '2026-09-29T12:00:00.000Z',
      capability: 'image_edit',
      params: { retouchDirections: ['brighten'] },
      requested_count: 1,
      provider_params: { resolution: '1k' },
    })
    expect(row).toMatchObject({
      label: '结算退回',
      title: '精修 1K×1',
      summary: '精修 1K×1 实扣 2',
      delta: 1,
      deltaText: '+1',
      balanceAfter: 98,
      charged: 2,
    })
  })

  it('视频复刻任务清理后，积分流水仍能显示任务名称和规格', () => {
    const row = presentCreditLedgerRow({
      id: '00000000-0000-4000-8000-000000000203',
      kind: 'reserve',
      delta: -80,
      balance_after: 20,
      charged: null,
      reason: null,
      created_at: '2026-11-19T01:00:00.000Z',
      capability: null,
      params: null,
      requested_count: null,
      provider_params: null,
      meta: { capability: 'text_to_video', mode: 'video_replication', resolution: '720p', durationSeconds: 5, unitPrice: 80 },
    })
    expect(row).toMatchObject({
      label: '提交预扣',
      title: '视频复刻 720P 5秒',
      summary: '视频复刻 720P 5秒',
      delta: -80,
    })
  })

  it('免费抠图显示免费文案，不显示实扣 0', () => {
    const base = {
      id: '00000000-0000-4000-8000-000000000202',
      delta: 0,
      balance_after: 30,
      charged: 0,
      reason: null,
      created_at: '2026-10-04T12:00:00.000Z',
      capability: null,
      params: null,
      requested_count: null,
      provider_params: null,
      meta: { tool: 'bg-remove', free: true, free_month: '2026-10' },
    }
    expect(presentCreditLedgerRow({ ...base, kind: 'settle' })).toMatchObject({
      label: '免费抠图', title: '免费抠图', summary: '本月免费额度', deltaText: '免费',
      presentation: { entryType: 'free_bg_remove', tool: 'bg-remove', status: 'settled' },
    })
    expect(presentCreditLedgerRow({ ...base, kind: 'refund' })).toMatchObject({
      label: '免费抠图', summary: '免费额度已退回', deltaText: '免费',
      presentation: { entryType: 'free_bg_remove', tool: 'bg-remove', status: 'refunded' },
    })
  })

  it('生成结构化 presentation 字段供多语言渲染和退款筛选使用', () => {
    const grant = presentCreditLedgerRow({
      id: '00000000-0000-4000-8000-000000000204',
      kind: 'grant',
      delta: 30,
      balance_after: 30,
      charged: null,
      meta: null,
      reason: '首次赠送',
      idempotency_key: 'initial',
      created_at: '2026-10-04T12:00:00.000Z',
      capability: null,
      params: null,
      requested_count: null,
      provider_params: null,
    })
    expect(grant.presentation).toEqual({ entryType: 'account', reasonCode: 'initial_grant' })

    const revoke = presentCreditLedgerRow({
      id: '00000000-0000-4000-8000-000000000205',
      kind: 'adjust',
      delta: -100,
      balance_after: 0,
      charged: null,
      meta: { orderId: 'o1', uncollectedCredits: 0 },
      reason: '现金退款或支付争议收回充值积分',
      idempotency_key: 'order:o1:revoke:100',
      created_at: '2026-10-04T12:00:00.000Z',
      capability: null,
      params: null,
      requested_count: null,
      provider_params: null,
    })
    expect(revoke.presentation).toEqual({ entryType: 'account', reasonCode: 'cash_refund_reclaim' })
  })
})
