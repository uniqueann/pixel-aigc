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

  it('裂变把结果条写成本次变体，选中项表示可继续编辑', () => {
    render(
      <ImageAssetStrip
        assets={assets}
        selectedAssetId="asset-2"
        variant="variation-result"
        onSelect={() => undefined}
        onPreview={() => undefined}
      />,
    )
    expect(screen.getByText('本次变体')).toBeTruthy()
    expect(screen.getByText('第 2 张已选中，可继续编辑或下载')).toBeTruthy()
    expect(screen.getByText('继续编辑')).toBeTruthy()
    expect(screen.getByRole('button', { name: '选择本次变体 2，可继续编辑' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '放大本次变体 1' })).toBeTruthy()
  })

  it('裂变未选中结果时提示先放大对比', () => {
    render(
      <ImageAssetStrip
        assets={assets}
        variant="variation-result"
        onSelect={() => undefined}
        onPreview={() => undefined}
      />,
    )
    expect(screen.getByText('点击缩略图放大对比；选中一张可继续编辑')).toBeTruthy()
    expect(screen.queryByText('下一轮输入')).toBeNull()
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
})
