// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SuiteProjectDetail } from '@shared/ecommerce-suite-runtime'
import type { SuiteClient } from './api'
import BatchPlanPanel from './BatchPlanPanel'

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
})
