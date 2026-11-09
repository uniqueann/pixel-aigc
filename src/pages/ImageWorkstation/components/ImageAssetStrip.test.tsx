// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ImageAsset } from '@/editor/types'
import ImageAssetStrip from './ImageAssetStrip'

const assets = [1, 2].map(index => ({
  id: `asset-${index}`,
  type: 'image',
  name: `结果 ${index}`,
  url: `blob:result-${index}`,
  mimeType: 'image/png',
  createdAt: new Date().toISOString(),
  source: 'generation',
  width: 1024,
  height: 1024,
})) as ImageAsset[]

afterEach(cleanup)

describe('智能编辑候选结果条', () => {
  it('标出当前选中的下一轮输入，并说明选择规则', () => {
    render(
      <ImageAssetStrip
        assets={assets}
        selectedAssetId="asset-2"
        onSelect={() => undefined}
        onPreview={() => undefined}
      />,
    )
    expect(screen.getByText('第 2 张将作为下一轮输入')).toBeTruthy()
    expect(screen.getByText('下一轮输入')).toBeTruthy()
    expect(screen.getByRole('button', { name: '选择候选结果 2，当前作为下一轮输入' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '选择候选结果 1' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('点击缩略图选择结果，放大和下载各自独立触发', () => {
    const onSelect = vi.fn()
    const onPreview = vi.fn()
    const onDownload = vi.fn()
    render(
      <ImageAssetStrip
        assets={assets}
        onSelect={onSelect}
        onPreview={onPreview}
        onDownload={onDownload}
      />,
    )
    expect(screen.getByText('选中一张作为下一轮输入')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '选择候选结果 1' }))
    expect(onSelect).toHaveBeenCalledWith('asset-1')
    fireEvent.click(screen.getByRole('button', { name: '放大候选结果 2' }))
    expect(onPreview).toHaveBeenCalledWith('asset-2')
    fireEvent.click(screen.getByRole('button', { name: '下载候选结果 1' }))
    expect(onDownload).toHaveBeenCalledWith(assets[0], 0)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('涂抹类工具把结果条写成本次结果，选中项表示当前原图', () => {
    render(
      <ImageAssetStrip
        assets={assets}
        selectedAssetId="asset-1"
        variant="inpaint-result"
        onSelect={() => undefined}
        onPreview={() => undefined}
      />,
    )
    expect(screen.getByText('本次结果')).toBeTruthy()
    expect(screen.getByText('第 1 张已作为当前原图，可继续编辑')).toBeTruthy()
    expect(screen.getByText('当前原图')).toBeTruthy()
    expect(screen.getByRole('button', { name: '选择结果 1，当前作为原图' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '放大结果 2' })).toBeTruthy()
  })

  it('涂抹类工具未选中结果时提示可继续编辑或直接下载', () => {
    render(
      <ImageAssetStrip
        assets={assets}
        variant="inpaint-result"
        onSelect={() => undefined}
        onPreview={() => undefined}
      />,
    )
    expect(screen.getByText('点击缩略图可基于该结果继续编辑，或直接下载')).toBeTruthy()
    expect(screen.queryByText('下一轮输入')).toBeNull()
  })

  it('融合结果条只描述预览，不承诺作为下一轮输入', () => {
    render(
      <ImageAssetStrip
        assets={assets}
        selectedAssetId="asset-2"
        variant="result"
        onSelect={() => undefined}
        onPreview={() => undefined}
      />,
    )
    expect(screen.getByText('本次结果')).toBeTruthy()
    expect(screen.getByText('第 2 张已在预览区显示')).toBeTruthy()
    expect(screen.getByText('预览中')).toBeTruthy()
    expect(screen.getByRole('button', { name: '选择结果 2，已在预览区显示' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByText('下一轮输入')).toBeNull()
  })

  it('融合结果条未选中时提示可在预览区查看', () => {
    render(
      <ImageAssetStrip
        assets={assets}
        variant="result"
        onSelect={() => undefined}
        onPreview={() => undefined}
      />,
    )
    expect(screen.getByText('点击缩略图在预览区查看，或直接下载')).toBeTruthy()
  })

  it('融合多结果改用两列网格并排对比', () => {
    const onDownloadAll = vi.fn()
    const { container } = render(
      <ImageAssetStrip
        assets={assets}
        selectedAssetId="asset-2"
        variant="result"
        layout="grid"
        onSelect={() => undefined}
        onPreview={() => undefined}
        onDownload={() => undefined}
        onDownloadAll={onDownloadAll}
      />,
    )
    expect(container.querySelector('.workstation-result-list.is-grid')).toBeTruthy()
    expect(screen.getByText('2 张')).toBeTruthy()
    expect(screen.getByText('第 2 张已在预览区显示')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '下载全部' }))
    expect(onDownloadAll).toHaveBeenCalledOnce()
  })

  it('单张结果不显示下载全部', () => {
    render(
      <ImageAssetStrip
        assets={[assets[0]]}
        variant="result"
        layout="grid"
        onSelect={() => undefined}
        onPreview={() => undefined}
        onDownloadAll={vi.fn()}
      />,
    )
    expect(screen.getByText('并排查看多张结果，点击图片在预览区查看')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '下载全部' })).toBeNull()
  })
})
