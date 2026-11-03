// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { App } from 'antd'
import type { PreviewItem } from '@/components/PreviewGallery'
import ResultGallery from './ResultGallery'

afterEach(() => cleanup())

const items: PreviewItem[] = [
  { id: 'first', thumbSrc: 'first-small.png', fullSrc: 'first.png', originalSrc: 'first-source.png', title: 'first.jpg' },
  { id: 'second', thumbSrc: 'second-small.png', fullSrc: 'second.png', title: 'second.jpg' },
]

function renderGallery(overrides: Partial<Parameters<typeof ResultGallery>[0]> = {}) {
  const props = {
    items,
    open: true,
    current: 0,
    onClose: vi.fn(),
    onChange: vi.fn(),
    onDownload: vi.fn(),
    ...overrides,
  }
  render(<App><ResultGallery {...props} /></App>)
  return props
}

describe('智能抠图结果画廊', () => {
  it('对话框有名称，图片有 alt，下载和对比在对话框内', () => {
    const props = renderGallery()
    const dialog = screen.getByRole('dialog', { name: /first\.jpg 抠图结果预览/ })
    expect(screen.getByAltText('first.jpg 的抠图结果')).toBeTruthy()
    const download = screen.getByRole('button', { name: /下载结果大图/ })
    const compare = screen.getByRole('button', { name: /对比原图/ })
    expect(dialog.contains(download)).toBe(true)
    expect(dialog.contains(compare)).toBe(true)
    fireEvent.click(download)
    expect(props.onDownload).toHaveBeenCalledWith(items[0])
  })

  it('透明结果使用棋盘格，纯色结果不显示棋盘格', () => {
    const { rerender } = render(<App><ResultGallery items={items} open current={0} onClose={vi.fn()} onChange={vi.fn()} onDownload={vi.fn()} checkerboard /></App>)
    expect(document.querySelector('.result-gallery-stage.is-transparent')).toBeTruthy()
    rerender(<App><ResultGallery items={items} open current={0} onClose={vi.fn()} onChange={vi.fn()} onDownload={vi.fn()} /></App>)
    expect(document.querySelector('.result-gallery-stage.is-transparent')).toBeNull()
  })

  it('上一张/下一张会通知当前索引，没有原图时不显示对比', () => {
    const props = renderGallery({ current: 1 })
    expect(screen.queryByRole('button', { name: /对比原图/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /上一张/ }))
    expect(props.onChange).toHaveBeenCalledWith(0)
  })

  it('关闭按钮调用 onClose', () => {
    const props = renderGallery()
    fireEvent.click(screen.getByRole('button', { name: /关闭/ }))
    expect(props.onClose).toHaveBeenCalledOnce()
  })
})
