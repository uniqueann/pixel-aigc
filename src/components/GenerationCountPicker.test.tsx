// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import GenerationCountPicker from './GenerationCountPicker'

afterEach(() => cleanup())

describe('生成数量选择', () => {
  it('只渲染模型允许的张数，窄面板里按钮平分宽度', () => {
    const onChange = vi.fn()
    render(<GenerationCountPicker value={3} max={2} onChange={onChange} />)
    const group = screen.getByRole('radiogroup', { name: '生成数量' })
    expect(group.className).toContain('generation-count-picker')
    expect(screen.getAllByRole('radio').map(item => (item as HTMLInputElement).value)).toEqual(['1', '2'])
    expect((screen.getByRole('radio', { name: '2' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: '1' }))
    expect(onChange).toHaveBeenCalledWith(1)
  })

  it('禁用时不改数量', () => {
    const onChange = vi.fn()
    render(<GenerationCountPicker value={1} max={4} disabled onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: '4' }))
    expect(onChange).not.toHaveBeenCalled()
  })
})