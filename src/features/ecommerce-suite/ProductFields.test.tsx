// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { suiteProjectConfigSchema, type SuiteProjectConfig } from '@shared/ecommerce-suite'
import ProductFields from './ProductFields'
import { getSlotUnreadyReason } from './batchPlan'

const contract = JSON.parse(readFileSync('docs/verification/ecommerce-suite/phase-one/contract-fixtures.json', 'utf8'))
const base: SuiteProjectConfig = { ...contract.project.config, facts: [] }

afterEach(cleanup)

function addAndCapture(label: string) {
  const onChange = vi.fn()
  render(<ProductFields value={base} onChange={onChange} />)
  fireEvent.click(screen.getByRole('button', { name: label }))
  return (onChange.mock.calls[0][0] as SuiteProjectConfig).facts
}

describe('商品规格与卖点新增行', () => {
  it('新增尺寸为未确认的空白草稿，可通过配置校验，且不满足槽位就绪', () => {
    const facts = addAndCapture('+ 添加尺寸')
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({ kind: 'dimension', confirmed: false, value: 0, subject: '' })
    expect(suiteProjectConfigSchema.safeParse({ ...base, facts }).success).toBe(true)
    const size = base.slots.find(slot => slot.kind === 'size')!
    expect(getSlotUnreadyReason(size, base.subcategory, facts)).toBe('需添加尺寸规格')
  })

  it('新增卖点为未确认的空白草稿，不满足槽位就绪', () => {
    const facts = addAndCapture('+ 添加卖点')
    expect(facts[0]).toMatchObject({ kind: 'feature', confirmed: false, value: '' })
    expect(suiteProjectConfigSchema.safeParse({ ...base, facts }).success).toBe(true)
    const feature = base.slots.find(slot => slot.kind === 'feature')!
    expect(getSlotUnreadyReason(feature, base.subcategory, facts)).toBe('需补充商品卖点')
  })

  it('空白行的确认开关不可用，填写后才能启用', () => {
    const facts = addAndCapture('+ 添加卖点')
    cleanup()
    const onChange = vi.fn()
    const { rerender } = render(<ProductFields value={{ ...base, facts }} onChange={onChange} />)
    expect((screen.getByRole('checkbox', { name: /启用此项/ }) as HTMLInputElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('卖点内容'), { target: { value: '高回弹海绵' } })
    const filled = (onChange.mock.calls[0][0] as SuiteProjectConfig).facts
    expect(filled[0]).toMatchObject({ value: '高回弹海绵', confirmed: false })
    rerender(<ProductFields value={{ ...base, facts: filled }} onChange={onChange} />)
    const toggle = screen.getByRole('checkbox', { name: /启用此项/ }) as HTMLInputElement
    expect(toggle.disabled).toBe(false)
    fireEvent.click(toggle)
    expect((onChange.mock.calls.at(-1)![0] as SuiteProjectConfig).facts[0].confirmed).toBe(true)
  })
})
