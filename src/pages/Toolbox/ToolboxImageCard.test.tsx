// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ToolboxImageCard, { PreviewResultActions, type ToolboxImageItem } from './ToolboxImageCard'

const image = (patch: Partial<ToolboxImageItem> & Pick<ToolboxImageItem, 'id' | 'status'>): ToolboxImageItem => ({
  name: `${patch.id}.jpg`,
  url: `blob:${patch.id}`,
  ...patch,
})

function renderCard(items: ToolboxImageItem[] = [], extra: Partial<Parameters<typeof ToolboxImageCard>[0]> = {}) {
  const props = {
    items,
    selectedId: items[0]?.id ?? null,
    disabled: false,
    onAdd: vi.fn(),
    onSelect: vi.fn(),
    onRemove: vi.fn(),
    onClear: vi.fn(),
    processingHint: '智能抠图会上传图片处理',
    ...extra,
  }
  render(<ToolboxImageCard {...props} />)
  return props
}

describe('工具箱图片卡片', () => {
  afterEach(() => cleanup())

  it('空状态是一条拖拽条，并沿用数量和限制说明', () => {
    renderCard()
    expect(screen.getByText('图片').parentElement?.textContent).toContain('0 / 20 张')
    expect(screen.getByRole('button', { name: /拖入图片，或点击选择/ })).toBeTruthy()
    expect(screen.getByText(/智能抠图会上传图片处理/)).toBeTruthy()
    expect(screen.getByText(/单张最多 20 MB，整批最多 150 MB/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '清空' })).toBeNull()
    expect(screen.queryByRole('button', { name: '添加图片' })).toBeNull()
  })

  it('有图片后显示添加方块、状态角标，并可选择、删除、清空', () => {
    const props = renderCard([
      image({ id: 'a', status: 'succeeded' }),
      image({ id: 'b', status: 'processing', note: '正在转比例' }),
      image({ id: 'c', status: 'pending' }),
      image({ id: 'd', status: 'failed', error: '抠图失败' }),
    ], { selectedId: 'a' })
    expect(screen.getByRole('button', { name: '添加图片' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '清空' })).toBeTruthy()
    expect(screen.getByText('完成')).toBeTruthy()
    expect(screen.getByText('处理中')).toBeTruthy()
    expect(screen.getByText('等待')).toBeTruthy()
    expect(screen.getByText('失败')).toBeTruthy()
    expect(screen.getByRole('button', { name: /预览 a\.jpg/ }).closest('.toolbox-image-tile')?.className).toContain('is-selected')
    expect(screen.getByRole('button', { name: /预览 b\.jpg/ }).getAttribute('aria-label')).toContain('正在转比例')
    expect(screen.getByRole('button', { name: /预览 a\.jpg/ }).getAttribute('title')).toBe('a.jpg')

    fireEvent.click(screen.getByRole('button', { name: /预览 b\.jpg/ }))
    expect(props.onSelect).toHaveBeenCalledWith('b')
    fireEvent.click(screen.getByRole('button', { name: '移除 c.jpg' }))
    expect(props.onRemove).toHaveBeenCalledWith('c')
    fireEvent.click(screen.getByRole('button', { name: '清空' }))
    expect(props.onClear).toHaveBeenCalledOnce()
  })

  it('处理中不能删除或继续添加，拖入整卡会高亮', () => {
    const props = renderCard([image({ id: 'a', status: 'processing' })], { disabled: true })
    fireEvent.click(screen.getByRole('button', { name: '移除 a.jpg' }))
    fireEvent.click(screen.getByRole('button', { name: '添加图片' }))
    expect(props.onRemove).not.toHaveBeenCalled()
    expect(props.onAdd).not.toHaveBeenCalled()

    const card = screen.getByRole('region', { name: '图片' })
    const file = new File(['x'], 'next.png', { type: 'image/png' })
    fireEvent.dragEnter(card, { dataTransfer: { files: [file], dropEffect: 'copy' } })
    expect(screen.queryByText('松开即可添加')).toBeNull()
    fireEvent.drop(card, { dataTransfer: { files: [file] } })
    expect(props.onAdd).not.toHaveBeenCalled()
  })

  it('点击和拖入都会把文件交给现有添加逻辑', () => {
    const props = renderCard()
    const file = new File(['x'], 'cup.jpg', { type: 'image/jpeg' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
    expect(props.onAdd).toHaveBeenCalledWith(file)

    const card = screen.getByRole('region', { name: '图片' })
    fireEvent.dragEnter(card, { dataTransfer: { files: [file], dropEffect: 'copy' } })
    expect(screen.getByText('松开即可添加')).toBeTruthy()
    expect(card.className).toContain('is-dragover')
    fireEvent.drop(card, { dataTransfer: { files: [file] } })
    expect(props.onAdd).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('松开即可添加')).toBeNull()
  })
})

describe('预览区单张下载', () => {
  afterEach(() => cleanup())

  it('未完成时下载置灰，失败时改为重试，完成后可下载', () => {
    const onDownload = vi.fn()
    const onRetry = vi.fn()
    const { rerender } = render(<PreviewResultActions status="pending" hasOutput={false} onDownload={onDownload} onRetry={onRetry} />)
    const locked = screen.getByTitle('处理完成后可下载')
    expect(locked.querySelector('button')?.hasAttribute('disabled')).toBe(true)
    expect(screen.queryByRole('button', { name: /重试/ })).toBeNull()

    rerender(<PreviewResultActions status="failed" hasOutput={false} busy onDownload={onDownload} onRetry={onRetry} />)
    expect(screen.queryByTitle('处理完成后可下载')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /重试/ }))
    expect(onRetry).not.toHaveBeenCalled()

    rerender(<PreviewResultActions status="failed" hasOutput={false} onDownload={onDownload} onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: /重试/ }))
    expect(onRetry).toHaveBeenCalledOnce()

    rerender(<PreviewResultActions status="succeeded" hasOutput retry onDownload={onDownload} onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: /下载/ }))
    fireEvent.click(screen.getByRole('button', { name: /重试/ }))
    expect(onDownload).toHaveBeenCalledOnce()
    expect(onRetry).toHaveBeenCalledTimes(2)
  })
})
