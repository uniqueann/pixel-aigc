// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CanvasArea from './CanvasArea'

describe('CanvasArea', () => {
  it('融合即使带着上一工具的图片也不展示预览', () => {
    render(
      <CanvasArea
        interactionMode="multi-source"
        imageUrl="https://example.com/perfume.png"
        originalImageUrl="https://example.com/perfume.png"
        imageNaturalSize={{ width: 1280, height: 1291 }}
        compareMode="effect"
        onCompareModeChange={vi.fn()}
        onImageUpload={vi.fn()}
        onReady={vi.fn()}
      />,
    )
    expect(screen.getByText('当前工具将在后续迭代中开放')).toBeTruthy()
    expect(screen.queryByAltText('当前编辑效果')).toBeNull()
    expect(screen.queryByText('上传需要处理的商品图片')).toBeNull()
  })
})
