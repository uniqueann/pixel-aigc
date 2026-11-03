// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { App } from 'antd'
import type { PreviewItem } from '@/components/PreviewGallery'
import ResultGrid, { type ResultFilter, type ResultGridItem } from './ResultGrid'

afterEach(() => cleanup())

const items: ResultGridItem[] = [
  { id: 'a', name: 'a.png', sourceUrl: 'blob:a', status: 'succeeded' },
  { id: 'b', name: 'b.png', sourceUrl: 'blob:b', status: 'failed' },
  { id: 'c', name: 'c.png', sourceUrl: 'blob:c', status: 'pending' },
]

const results = new Map<string, PreviewItem>([
  ['a', { id: 'a', thumbSrc: 'blob:a', fullSrc: 'blob:a-result', originalSrc: 'blob:a', title: 'a.png' }],
])

function renderGrid(overrides: Partial<Parameters<typeof ResultGrid>[0]> = {}) {
  const props = {
    items,
    results,
    selectedId: 'a',
    filter: 'all' as ResultFilter,
    onFilterChange: vi.fn(),
    onSelect: vi.fn(),
    ariaLabel: '水印结果网格',
    ...overrides,
  }
  render(<App><ResultGrid {...props} /></App>)
  return props
}

describe('结果网格', () => {
  it('显示结果缩略图、状态文案与选中态', () => {
    renderGrid()
    expect(screen.getByRole('group', { name: '水印结果网格' })).toBeTruthy()
    const selected = screen.getByRole('button', { name: 'a.png，完成，查看结果' })
    expect(selected.getAttribute('aria-pressed')).toBe('true')
    expect(selected.querySelector('img')?.getAttribute('src')).toBe('blob:a-result')
    expect(screen.getByRole('button', { name: 'b.png，失败' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'c.png，等待' })).toBeTruthy()
  })

  it('筛选失败项并回传选择', () => {
    const props = renderGrid({ filter: 'failed' })
    expect(screen.queryByRole('button', { name: /a\.png/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'b.png，失败' }))
    expect(props.onSelect).toHaveBeenCalledWith('b')
  })

  it('筛选无结果时显示空态', () => {
    renderGrid({ items: items.filter(item => item.status === 'succeeded'), filter: 'failed' })
    expect(screen.getByText('没有符合筛选的结果')).toBeTruthy()
  })

  it('透明结果只在开启棋盘格时显示透明底', () => {
    renderGrid({ checkerboard: true })
    const succeeded = screen.getByRole('button', { name: 'a.png，完成，查看结果' })
    const failed = screen.getByRole('button', { name: 'b.png，失败' })
    expect(succeeded.querySelector('img')?.parentElement?.className).toContain('is-transparent')
    expect(failed.querySelector('img')?.parentElement?.className).not.toContain('is-transparent')
  })
})
