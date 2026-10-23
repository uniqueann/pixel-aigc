// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

const contract = JSON.parse(readFileSync('docs/verification/ecommerce-suite/phase-one/contract-fixtures.json', 'utf8'))
const project = contract.project
const clickEstimate = async () => {
  await waitFor(() => expect((screen.getByRole('button', { name: /预估费用/ }) as HTMLButtonElement).disabled).toBe(false))
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
  const client = { assertCurrent: vi.fn(), get: vi.fn(async () => ({ project })), quote: vi.fn(async () => quote) } as unknown as SuiteClient
  const onSubmit = vi.fn(async () => undefined)
  const onEdit = vi.fn()
  render(<App><GenerationPanel project={project} slot={slot} client={client} blocked={false}
    draft={{ value: { modelProfileId: 'mock-model', resolution: '1k', count: 2, promptNote: '', ...draftValue } as never }}
    flush={async () => undefined} flushDraft={async () => undefined} onSubmit={onSubmit} onEdit={onEdit} onError={vi.fn()} /></App>)
  return { client, onSubmit, onEdit, slot }
}

describe('单槽位生成面板费用确认', () => {
  beforeEach(() => { window.HTMLElement.prototype.scrollIntoView = vi.fn() })
  afterEach(() => { cleanup(); vi.clearAllMocks() })

  it('生图槽位先展示预估积分，用户确认后才提交', async () => {
    const slot = slotOf('scene')
    const quote = makeQuote(slot.id, 'image_edit', 12, 2)
    const { client, onSubmit } = setup('scene', quote)
    await clickEstimate()
    await waitFor(() => expect(screen.getByRole('button', { name: '确认生成 2 张 · 12 积分' })).toBeTruthy())
    expect(client.quote).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认生成 2 张 · 12 积分' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(quote))
  })

  it('返回修改会丢弃预估，不提交', async () => {
    const slot = slotOf('scene')
    const { onSubmit } = setup('scene', makeQuote(slot.id, 'image_edit', 12, 2))
    await clickEstimate()
    fireEvent.click(await screen.findByRole('button', { name: '返回修改' }))
    expect(screen.queryByRole('button', { name: /确认生成/ })).toBeNull()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('复用/免费槽位按钮标注免费', async () => {
    const slot = slotOf('main')
    const quote = makeQuote(slot.id, 'reuse', 0)
    const { onSubmit } = setup('main', quote)
    fireEvent.click(await screen.findByRole('button', { name: '确认底图设置 · 免费' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(quote))
  })
})
