// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CanvasAddImageButton from './CanvasAddImageButton'

describe('画布添加图片按钮', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('点击后弹出本地上传和从我的资产，并沿用原来的两项操作', async () => {
    const onUpload = vi.fn()
    const onPickAsset = vi.fn()
    render(<CanvasAddImageButton importing={false} disabled={false} onUpload={onUpload} onPickAsset={onPickAsset} />)
    const button = document.querySelector('button[aria-label="添加图片"]')
    expect(button).not.toBeNull()
    expect(button?.textContent).toContain('添加图片')
    fireEvent.click(button!)
    expect(await screen.findByText('本地上传')).toBeTruthy()
    expect(screen.getByText('从我的资产')).toBeTruthy()
    fireEvent.click(screen.getByText('本地上传'))
    fireEvent.click(button!)
    fireEvent.click(await screen.findByText('从我的资产'))
    expect(onUpload).toHaveBeenCalledOnce()
    expect(onPickAsset).toHaveBeenCalledOnce()
  })

  it('生成中或导入中不打开菜单', () => {
    const onUpload = vi.fn()
    const onPickAsset = vi.fn()
    const { rerender } = render(<CanvasAddImageButton importing={false} disabled onUpload={onUpload} onPickAsset={onPickAsset} />)
    fireEvent.click(document.querySelector('button[aria-label="添加图片"]')!)
    expect(screen.queryByText('本地上传')).toBeNull()

    rerender(<CanvasAddImageButton importing disabled={false} onUpload={onUpload} onPickAsset={onPickAsset} />)
    fireEvent.click(document.querySelector('button[aria-label="添加图片"]')!)
    expect(screen.queryByText('本地上传')).toBeNull()
    expect(onUpload).not.toHaveBeenCalled()
    expect(onPickAsset).not.toHaveBeenCalled()
  })
})
