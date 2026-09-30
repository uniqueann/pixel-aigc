// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import PreviewGallery, { type PreviewItem } from './PreviewGallery'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const items: PreviewItem[] = [
  { id: 'first', thumbSrc: 'first-small.png', fullSrc: 'first.png', originalSrc: 'source.png' },
  { id: 'second', thumbSrc: 'second-small.png', fullSrc: 'second.png' },
]

describe('PreviewGallery', () => {
  it('仅有源图时显示对比，并在切换到无源图结果时回到普通预览', async () => {
    const getComputedStyle = window.getComputedStyle
    vi.spyOn(window, 'getComputedStyle').mockImplementation(element => getComputedStyle(element))
    const onChange = vi.fn()
    const { rerender } = render(<App><PreviewGallery items={items} open current={0} onClose={vi.fn()} onChange={onChange} /></App>)
    fireEvent.click(await screen.findByRole('button', { name: '对比原图与结果' }))
    expect(screen.getByText('左：原图 · 右：结果')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '下一张' }))
    expect(onChange).toHaveBeenCalledWith(1)
    rerender(<App><PreviewGallery items={items} open current={1} onClose={vi.fn()} onChange={onChange} /></App>)
    await waitFor(() => expect(screen.queryByText('左：原图 · 右：结果')).toBeNull())
    expect(screen.queryByRole('button', { name: '对比原图与结果' })).toBeNull()
  })

  it('缩放同步作用于两张图，按住原图后松开恢复滑块', async () => {
    const getComputedStyle = window.getComputedStyle
    vi.spyOn(window, 'getComputedStyle').mockImplementation(element => getComputedStyle(element))
    render(<App><PreviewGallery items={items} open current={0} onClose={vi.fn()} onChange={vi.fn()} /></App>)
    fireEvent.click(await screen.findByRole('button', { name: '对比原图与结果' }))
    const stage = document.querySelector('.compare-stage') as HTMLElement
    const images = document.querySelectorAll('.compare-layer img')
    fireEvent.wheel(stage, { deltaY: -100 })
    expect((images[0] as HTMLElement).style.transform).toContain('scale(1.12)')
    expect((images[0] as HTMLElement).style.transform).toBe((images[1] as HTMLElement).style.transform)
    const original = document.querySelector('.compare-original-layer') as HTMLElement
    const hold = screen.getByRole('button', { name: '按住查看原图（空格）' })
    fireEvent.pointerDown(hold)
    expect(original.style.clipPath).toBe('')
    fireEvent.pointerUp(hold)
    expect(original.style.clipPath).toContain('inset')
    fireEvent.doubleClick(stage)
    expect((images[0] as HTMLElement).style.transform).toContain('scale(1)')
  })

  it('真实 antd/rc-image 预览在 onLoad 后显示图片', async () => {
    const getComputedStyle = window.getComputedStyle
    vi.spyOn(window, 'getComputedStyle').mockImplementation(element => getComputedStyle(element))
    render(<App><PreviewGallery items={items} open current={0} onClose={vi.fn()} onChange={vi.fn()} /></App>)
    const preview = await waitFor(() => document.querySelector('.ant-image-preview-img') as HTMLImageElement)
    expect(preview).toBeTruthy()
    expect(preview.style.visibility).toBe('hidden')
    expect(document.querySelector('.preview-load-state')).toBeTruthy()
    fireEvent.load(preview)
    await waitFor(() => expect(preview.style.visibility).toBe('visible'))
    expect(document.querySelector('.preview-load-state')).toBeNull()
  })

  it('对比图用自己的 onLoad，加载完成后可见', async () => {
    const getComputedStyle = window.getComputedStyle
    vi.spyOn(window, 'getComputedStyle').mockImplementation(element => getComputedStyle(element))
    render(<App><PreviewGallery items={items} open current={0} onClose={vi.fn()} onChange={vi.fn()} /></App>)
    fireEvent.click(await screen.findByRole('button', { name: '对比原图与结果' }))
    const images = [...document.querySelectorAll('.compare-layer img')] as HTMLImageElement[]
    expect(images).toHaveLength(2)
    expect(images.every(image => image.style.visibility === 'hidden')).toBe(true)
    images.forEach(image => fireEvent.load(image))
    expect(images.every(image => image.style.visibility === 'visible')).toBe(true)
    expect(document.querySelector('.compare-image-status')).toBeNull()
  })

  it('预览加载失败时可以重试', async () => {
    const getComputedStyle = window.getComputedStyle
    vi.spyOn(window, 'getComputedStyle').mockImplementation(element => getComputedStyle(element))
    render(<App><PreviewGallery items={items} open current={0} onClose={vi.fn()} onChange={vi.fn()} /></App>)
    const preview = await waitFor(() => document.querySelector('.ant-image-preview-img') as HTMLImageElement)
    fireEvent.error(preview)
    expect(await screen.findByText('图片加载失败')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }))
    const retried = await waitFor(() => document.querySelector('.ant-image-preview-img') as HTMLImageElement)
    expect(retried.style.visibility).toBe('hidden')
    fireEvent.load(retried)
    await waitFor(() => expect(retried.style.visibility).toBe('visible'))
  })

  it('加载后点放大不抛错', async () => {
    const getComputedStyle = window.getComputedStyle
    vi.spyOn(window, 'getComputedStyle').mockImplementation(element => getComputedStyle(element))
    render(<App><PreviewGallery items={items} open current={0} onClose={vi.fn()} onChange={vi.fn()} /></App>)
    const preview = await waitFor(() => document.querySelector('.ant-image-preview-img') as HTMLImageElement)
    Object.defineProperty(preview, 'width', { value: 1200 })
    Object.defineProperty(preview, 'height', { value: 800 })
    Object.defineProperty(preview, 'offsetWidth', { value: 1200 })
    Object.defineProperty(preview, 'offsetHeight', { value: 800 })
    Object.defineProperty(preview, 'offsetLeft', { value: 10 })
    Object.defineProperty(preview, 'offsetTop', { value: 10 })
    fireEvent.load(preview)
    await waitFor(() => expect(preview.style.visibility).toBe('visible'))
    const zoomIn = document.querySelector('.ant-image-preview-operations-operation-zoomIn') as HTMLElement
    expect(zoomIn).toBeTruthy()
    expect(() => fireEvent.click(zoomIn)).not.toThrow()
  })
})
