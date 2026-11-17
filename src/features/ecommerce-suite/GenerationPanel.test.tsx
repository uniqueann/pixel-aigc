// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SuiteQuote } from '@shared/ecommerce-suite'
import type { SuiteClient } from './api'
import GenerationPanel from './GenerationPanel'

vi.mock('@/services/api/imageModels', () => ({
  listImageModels: vi.fn(async () => [
    { id: 'mock-model', label: '模拟生图模型', provider: 'mock', ui: { resolutions: ['1k', '2k'], maxCount: 4, promptMaxLength: 4000 } },
  ]),
}))

// 等待只用于让 React 冲刷状态；报价本身由用例显式 resolve，不再依赖机器快慢。
const ASYNC_UI_TIMEOUT = { timeout: 3000 }
const contract = JSON.parse(readFileSync('docs/verification/ecommerce-suite/phase-one/contract-fixtures.json', 'utf8'))
const project = contract.project
const clickEstimate = async () => {
  await waitFor(() => expect((screen.getByRole('button', { name: /预估费用/ }) as HTMLButtonElement).disabled).toBe(false), ASYNC_UI_TIMEOUT)
  fireEvent.click(screen.getByRole('button', { name: /预估费用/ }))
}
const slotOf = (key: string) => project.config.slots.find((slot: { key: string }) => slot.key === key)

function makeQuote(slotId: string, mode: 'image_edit' | 'reuse', credits: number, count = 1): SuiteQuote {
  return {
    id: 'quote-1', expectedRevision: project.revision, planFingerprint: 'fp', totalCredits: credits,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    items: [{ operationId: 'op-1', slotId, slotKind: 'scene', sourceAssetId: 'asset', mode, count: mode === 'reuse' ? 1 : count, credits,
      ...(mode === 'image_edit' ? { modelProfileId: 'mock-model', resolution: '1k', unitCredits: credits / count, size: { width: 1600, height: 1600 }, promptSnapshot: 'p' } : {}) }],
  } as unknown as SuiteQuote
}

function setup(slotKey: string, quote: SuiteQuote, draftValue: object = {}) {
  const slot = slotOf(slotKey)
  // 报价由用例显式 resolve：断言不再取决于 jsdom 事件循环多快轮到微任务。
  let resolveQuote: ((value: SuiteQuote) => void) | undefined
  const client = {
    assertCurrent: vi.fn(),
    get: vi.fn(async () => ({ project })),
    quote: vi.fn(() => new Promise<SuiteQuote>((resolve) => { resolveQuote = resolve })),
  } as unknown as SuiteClient
  const onSubmit = vi.fn(async () => undefined)
  const onEdit = vi.fn()
  render(<App><GenerationPanel project={project} slot={slot} client={client} blocked={false}
    draft={{ value: { modelProfileId: 'mock-model', resolution: '1k', count: 2, promptNote: '', ...draftValue } as never }}
    flush={async () => undefined} flushDraft={async () => undefined} onSubmit={onSubmit} onEdit={onEdit} onError={vi.fn()} /></App>)
  /** 等报价请求真的发出去（点击后的 await 链需要跑到这里）。 */
  const quoteRequested = () => waitFor(() => expect(client.quote).toHaveBeenCalled(), ASYNC_UI_TIMEOUT)
  /** 显式让报价落定，断言不再取决于机器快慢。 */
  const resolveEstimate = async () => { await act(async () => { resolveQuote?.(quote) }) }
  return { client, onSubmit, onEdit, slot, quoteRequested, resolveEstimate }
}

describe('单槽位生成面板费用确认', () => {
  beforeEach(() => { window.HTMLElement.prototype.scrollIntoView = vi.fn() })
  afterEach(() => { cleanup(); vi.clearAllMocks() })

  it('生图槽位先展示预估积分，用户确认后才提交', async () => {
    const slot = slotOf('scene')
    const quote = makeQuote(slot.id, 'image_edit', 12, 2)
    const { client, onSubmit, quoteRequested, resolveEstimate } = setup('scene', quote)
    await clickEstimate()
    await quoteRequested()
    expect(client.quote).toHaveBeenCalledTimes(1)
    // 报价还没回来时不该出现确认按钮，避免"点了就提交"的误判。
    expect(screen.queryByRole('button', { name: /确认生成/ })).toBeNull()
    expect(onSubmit).not.toHaveBeenCalled()

    await resolveEstimate()
    fireEvent.click(await screen.findByRole('button', { name: '确认生成 2 张 · 12 积分' }, ASYNC_UI_TIMEOUT))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(quote), ASYNC_UI_TIMEOUT)
  })

  it('返回修改会丢弃预估，不提交', async () => {
    const slot = slotOf('scene')
    const { onSubmit, quoteRequested, resolveEstimate } = setup('scene', makeQuote(slot.id, 'image_edit', 12, 2))
    await clickEstimate()
    await quoteRequested()
    await resolveEstimate()
    fireEvent.click(await screen.findByRole('button', { name: '返回修改' }, ASYNC_UI_TIMEOUT))
    expect(screen.queryByRole('button', { name: /确认生成/ })).toBeNull()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('复用/免费槽位按钮标注免费', async () => {
    const slot = slotOf('main')
    const quote = makeQuote(slot.id, 'reuse', 0)
    const { onSubmit, quoteRequested, resolveEstimate } = setup('main', quote)
    fireEvent.click(await screen.findByRole('button', { name: '确认底图设置 · 免费' }, ASYNC_UI_TIMEOUT))
    await quoteRequested()
    await resolveEstimate()
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(quote), ASYNC_UI_TIMEOUT)
  })
})
