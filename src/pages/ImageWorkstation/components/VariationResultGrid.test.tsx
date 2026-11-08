// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ImageAsset } from '@/editor/types'
import VariationResultGrid from './VariationResultGrid'

const assets = [1, 2].map(index => ({
  id: `asset-${index}`,
  type: 'image',
  name: `变体 ${index}`,
  url: `blob:variation-${index}`,
  mimeType: 'image/png',
  createdAt: new Date().toISOString(),
  source: 'generation',
  width: 1024,
  height: 1024,
})) as ImageAsset[]

afterEach(cleanup)

describe('裂变结果网格', () => {
  it('并排展示变体编号、尺寸与批量下载入口', () => {
    const onDownloadAll = vi.fn()
    render(
      <VariationResultGrid
        assets={assets}
        onSelect={() => undefined}
        onDownload={() => undefined}
        onPreview={() => undefined}
        onDownloadAll={onDownloadAll}
      />,
    )
    expect(screen.getByRole('region', { name: '本次变体' })).toBeTruthy()
    expect(screen.getByText('本次变体')).toBeTruthy()
    expect(screen.getByText('2 张')).toBeTruthy()
    expect(screen.getByText('点击图片放大对比；选一张可继续编辑')).toBeTruthy()
    expect(screen.getAllByText('1024×1024')).toHaveLength(2)
    expect(screen.getByRole('button', { name: '查看变体 1 大图' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '查看变体 2 大图' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '下载全部' }))
    expect(onDownloadAll).toHaveBeenCalledTimes(1)
  })

  it('放大、继续编辑与下载各自独立触发', () => {
    const onSelect = vi.fn()
    const onDownload = vi.fn()
    const onPreview = vi.fn()
    render(
      <VariationResultGrid
        assets={assets}
        onSelect={onSelect}
        onDownload={onDownload}
        onPreview={onPreview}
        onDownloadAll={() => undefined}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '查看变体 1 大图' }))
    expect(onPreview).toHaveBeenCalledWith('asset-1')
    fireEvent.click(screen.getByRole('button', { name: '基于变体 2 继续编辑' }))
    expect(onSelect).toHaveBeenCalledWith('asset-2')
    fireEvent.click(screen.getByRole('button', { name: '下载变体 1' }))
    expect(onDownload).toHaveBeenCalledWith(assets[0], 0)
    expect(onPreview).toHaveBeenCalledTimes(1)
  })

  it('选中项标出下一轮输入，继续编辑按钮进入按下态', () => {
    render(
      <VariationResultGrid
        assets={assets}
        selectedAssetId="asset-2"
        onSelect={() => undefined}
        onDownload={() => undefined}
        onPreview={() => undefined}
      />,
    )
    expect(screen.getByText('第 2 张已选为下一轮输入')).toBeTruthy()
    expect(screen.getByText('已选中')).toBeTruthy()
    expect(screen.getByRole('button', { name: '基于变体 2 继续编辑' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '基于变体 1 继续编辑' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('单张结果不提供批量下载，避免生成只有一个文件的压缩包', () => {
    render(
      <VariationResultGrid
        assets={assets.slice(0, 1)}
        onSelect={() => undefined}
        onDownload={() => undefined}
        onPreview={() => undefined}
        onDownloadAll={() => undefined}
      />,
    )
    expect(screen.getByText('1 张')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '下载全部' })).toBeNull()
  })
})
