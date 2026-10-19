// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SuiteProjectDetail } from '@shared/ecommerce-suite-runtime'
import type { SuiteClient } from './api'
import BatchPlanPanel from './BatchPlanPanel'
import { getSlotUnreadyReason } from './batchPlan'

vi.mock('@/services/api/imageModels', () => ({
  listImageModels: vi.fn(async () => [
    { id: 'mock-model', label: '模拟生图模型', provider: 'mock', ui: { resolutions: ['1k', '2k'], maxCount: 1 } },
  ]),
}))

const contract = JSON.parse(readFileSync('docs/verification/ecommerce-suite/phase-one/contract-fixtures.json', 'utf8'))
const project = contract.project

function makeDetail(): SuiteProjectDetail {
  return {
    project,
    assets: [],
    versions: [],
    drafts: [],
    batches: [],
    operations: [],
    tasks: [],
  } as unknown as SuiteProjectDetail
}

const mockQuote = {
  quoteId: 'quote-1',
  expiresAt: new Date(Date.now() + 60000).toISOString(),
  totalCredits: 30,
  items: [
    {
      operationId: 'op-1',
      slotId: project.config.slots[0].id,
      mode: 'reuse' as const,
      modelProfileId: 'mock-model',
      resolution: '1k' as const,
      count: 1,
      size: { width: 1600, height: 1600 },
      unitCredits: 0,
      credits: 0,
    },
    {
      operationId: 'op-2',
      slotId: project.config.slots[1].id,
      mode: 'image_edit' as const,
      modelProfileId: 'mock-model',
      resolution: '1k' as const,
      count: 1,
      size: { width: 1600, height: 1600 },
      unitCredits: 30,
      credits: 30,
      promptSnapshot: '居室场景测试提示词',
    },
  ],
}

describe('全套批量生成费用预估面板 (BatchPlanPanel)', () => {
  beforeEach(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('点击计算预估费用时展示即时加载状态，成功后展示费用预估完成卡片与提交按钮', async () => {
    const data = makeDetail()
    let resolveQuote: (value: typeof mockQuote) => void
    const quotePromise = new Promise<typeof mockQuote>(resolve => { resolveQuote = resolve })
    const client = {
      assertCurrent: vi.fn(),
      get: vi.fn(async () => data),
      quote: vi.fn(() => quotePromise),
    } as unknown as SuiteClient
    const flush = vi.fn(async () => undefined)
    const onSubmit = vi.fn(async () => undefined)
    const onClose = vi.fn()
    const onError = vi.fn()

    render(
      <App>
        <BatchPlanPanel
          data={data}
          client={client}
          blocked={false}
          flush={flush}
          onSubmit={onSubmit}
          onClose={onClose}
          onError={onError}
        />
      </App>
    )

    // 等待模型异步加载完成，按钮变为可点击
    const calcButton = await screen.findByRole('button', { name: '计算预估费用' })
    expect(calcButton).toBeTruthy()

    // 点击计算
    fireEvent.click(calcButton)

    // 立即出现加载反馈与提示文本
    expect(screen.getByText('正在计算预估费用...')).toBeTruthy()
    expect(screen.getByText('正在核对所选槽位并计算预估费用…')).toBeTruthy()

    // 模拟服务端返回结果
    await act(async () => {
      resolveQuote!(mockQuote)
    })

    // 成功后展示醒目的费用完成提示 Alert 与槽位消耗说明
    await waitFor(() => {
      expect(screen.getByText('费用预估已完成')).toBeTruthy()
    })
    expect(screen.getAllByText(/最高预估消耗 30 积分/).length).toBeGreaterThanOrEqual(1)

    // 滚动引导方法被调用
    await waitFor(() => {
      expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled()
    })

    // 底部主按钮更新为开始批量生成
    expect(screen.getByRole('button', { name: /开始批量生成 · 30 积分上限/ })).toBeTruthy()
  })

  it('计算预估费用失败时，在弹窗内直接显示错误 Alert，不静默无反应', async () => {
    const data = makeDetail()
    const client = {
      assertCurrent: vi.fn(),
      get: vi.fn(async () => { throw new Error('网络连接异常，无法获取项目配置') }),
      quote: vi.fn(),
    } as unknown as SuiteClient
    const flush = vi.fn(async () => undefined)
    const onSubmit = vi.fn(async () => undefined)
    const onClose = vi.fn()
    const onError = vi.fn()

    render(
      <App>
        <BatchPlanPanel
          data={data}
          client={client}
          blocked={false}
          flush={flush}
          onSubmit={onSubmit}
          onClose={onClose}
          onError={onError}
        />
      </App>
    )

    // 等待模型加载完成
    const calcButton = await screen.findByRole('button', { name: '计算预估费用' })
    fireEvent.click(calcButton)

    await waitFor(() => {
      expect(screen.getByText('费用预估未完成')).toBeTruthy()
      expect(screen.getByText('网络连接异常，无法获取项目配置')).toBeTruthy()
    })

    // 错误后按钮恢复原状，可再次点击重试
    expect(screen.getByRole('button', { name: '计算预估费用' })).toBeTruthy()
    expect(onError).toHaveBeenCalled()
  })

  it('当项目未配置商品事实时，卖点和尺寸槽位展示对应提示并默认不勾选与禁用', async () => {
    const emptyFactsProject = {
      ...project,
      config: {
        ...project.config,
        facts: [],
      },
    }
    const data = {
      ...makeDetail(),
      project: emptyFactsProject,
    }
    const client = {
      assertCurrent: vi.fn(),
      get: vi.fn(async () => data),
      quote: vi.fn(),
    } as unknown as SuiteClient
    const flush = vi.fn(async () => undefined)
    const onSubmit = vi.fn(async () => undefined)
    const onClose = vi.fn()
    const onError = vi.fn()

    render(
      <App>
        <BatchPlanPanel
          data={data}
          client={client}
          blocked={false}
          flush={flush}
          onSubmit={onSubmit}
          onClose={onClose}
          onError={onError}
        />
      </App>
    )

    // 等待模型异步加载完成
    await screen.findByRole('button', { name: '计算预估费用' })

    // 辅助提示文本正确渲染
    expect(screen.getByText('需补充商品卖点')).toBeTruthy()
    expect(screen.getByText('需添加尺寸规格')).toBeTruthy()
    expect(screen.getByText('需细节参考图')).toBeTruthy()

    // 检查对应的 Checkbox 是否被禁用且未勾选
    const featureCheckbox = screen.getByRole('checkbox', { name: /卖点/ }) as HTMLInputElement
    const sizeCheckbox = screen.getByRole('checkbox', { name: /尺寸/ }) as HTMLInputElement
    const detailCheckbox = screen.getByRole('checkbox', { name: /细节/ }) as HTMLInputElement
    expect(featureCheckbox.disabled).toBe(true)
    expect(featureCheckbox.checked).toBe(false)
    expect(sizeCheckbox.disabled).toBe(true)
    expect(sizeCheckbox.checked).toBe(false)
    expect(detailCheckbox.disabled).toBe(true)
    expect(detailCheckbox.checked).toBe(false)

    // 白底主图与场景图等就绪槽位默认勾选且未被禁用
    const mainCheckbox = screen.getByRole('checkbox', { name: /白底/ }) as HTMLInputElement
    expect(mainCheckbox.checked).toBe(true)
    expect(mainCheckbox.disabled).toBe(false)
  })

  it('当服务端返回槽位缺少卖点或规格的具体错误时，弹窗 Alert 完整展示该指引文案', async () => {
    const data = makeDetail()
    const slotErrorMessage = '【主图 4 · 卖点】缺少卖点或规格，请先在“商品信息与规格”中补充并确认'
    const client = {
      assertCurrent: vi.fn(),
      get: vi.fn(async () => data),
      quote: vi.fn(async () => { throw new Error(slotErrorMessage) }),
    } as unknown as SuiteClient
    const flush = vi.fn(async () => undefined)
    const onSubmit = vi.fn(async () => undefined)
    const onClose = vi.fn()
    const onError = vi.fn()

    render(
      <App>
        <BatchPlanPanel
          data={data}
          client={client}
          blocked={false}
          flush={flush}
          onSubmit={onSubmit}
          onClose={onClose}
          onError={onError}
        />
      </App>
    )

    const calcButton = await screen.findByRole('button', { name: '计算预估费用' })
    fireEvent.click(calcButton)

    await waitFor(() => {
      expect(screen.getByText('费用预估未完成')).toBeTruthy()
      expect(screen.getByText(slotErrorMessage)).toBeTruthy()
    })
  })
})

describe('getSlotUnreadyReason 槽位不可用原因判定', () => {
  it('槽位被跳过时返回“已跳过”', () => {
    const slot = { id: 's1', key: 'main' as const, kind: 'main' as const, name: '主图 1 · 白底', enabled: false, referenceAssetIds: [], order: 0 }
    expect(getSlotUnreadyReason(slot, 'furniture', [])).toBe('已跳过')
  })

  it('细节参考槽位缺少参考照片时返回“需细节参考图”', () => {
    const slot = { id: 's6', key: 'detail' as const, kind: 'detail' as const, name: '主图 6 · 细节', enabled: true, referenceAssetIds: [], order: 5 }
    expect(getSlotUnreadyReason(slot, 'furniture', [])).toBe('需细节参考图')
  })

  it('尺寸槽位缺少确认的尺寸/容量规格时返回“需添加尺寸规格”', () => {
    const slot = { id: 's5', key: 'size' as const, kind: 'size' as const, name: '主图 5 · 尺寸', enabled: true, referenceAssetIds: [], order: 4 }
    expect(getSlotUnreadyReason(slot, 'furniture', [])).toBe('需添加尺寸规格')
    expect(getSlotUnreadyReason(slot, 'furniture', [{ kind: 'dimension', confirmed: false }])).toBe('需添加尺寸规格')
    expect(getSlotUnreadyReason(slot, 'furniture', [{ kind: 'feature', confirmed: true }])).toBe('需添加尺寸规格')
    expect(getSlotUnreadyReason(slot, 'furniture', [{ kind: 'dimension', confirmed: true }])).toBe('')
  })

  it('需要商品事实的卖点槽位缺少确认事实时返回“需补充商品卖点”', () => {
    const slot = { id: 's4', key: 'feature' as const, kind: 'feature' as const, name: '主图 4 · 卖点', enabled: true, referenceAssetIds: [], order: 3 }
    expect(getSlotUnreadyReason(slot, 'furniture', [])).toBe('需补充商品卖点')
    expect(getSlotUnreadyReason(slot, 'furniture', [{ kind: 'feature', confirmed: false }])).toBe('需补充商品卖点')
    expect(getSlotUnreadyReason(slot, 'furniture', [{ kind: 'feature', confirmed: true }])).toBe('')
  })
})
