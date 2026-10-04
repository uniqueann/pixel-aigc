// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import PreviewGallery, { type PreviewItem } from './PreviewGallery'
import * as ownedImages from '@/services/api/ownedImages'
import * as historyOwner from '@/features/assets/historyOwner'
import * as ownedVideos from '@/services/api/ownedVideos'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

const items: PreviewItem[] = [
  { id: 'first', thumbSrc: 'first-small.png', fullSrc: 'first.png', originalSrc: 'source.png' },
  { id: 'second', thumbSrc: 'second-small.png', fullSrc: 'second.png' },
]

function stubPreviewMetrics(image: HTMLImageElement) {
  Object.defineProperty(image, 'width', { configurable: true, value: 1200 })
  Object.defineProperty(image, 'height', { configurable: true, value: 800 })
  Object.defineProperty(image, 'offsetWidth', { configurable: true, value: 1200 })
  Object.defineProperty(image, 'offsetHeight', { configurable: true, value: 800 })
  Object.defineProperty(image, 'offsetLeft', { configurable: true, value: 10 })
  Object.defineProperty(image, 'offsetTop', { configurable: true, value: 10 })
}

function mockOverlayStyle() {
  const getComputedStyle = window.getComputedStyle
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => getComputedStyle(element))
}

function frameState(image: Element) {
  return image.closest('.preview-image-frame')?.getAttribute('data-state')
}

function zoomInButton() {
  return document.querySelector('.ant-image-preview-operations-operation-zoomIn') as HTMLElement
}

function collectConsoleErrors() {
  const errors: string[] = []
  const consoleError = vi.spyOn(console, 'error').mockImplementation((...args) => {
    errors.push(args.map(item => item instanceof Error ? item.message : String(item)).join(' '))
  })
  const onWindowError = (event: ErrorEvent) => {
    errors.push(String(event.error instanceof Error ? event.error.message : event.message))
  }
  window.addEventListener('error', onWindowError)
  return {
    errors,
    restore() {
      consoleError.mockRestore()
      window.removeEventListener('error', onWindowError)
    },
  }
}

describe('PreviewGallery', () => {
  it('视频只挂载当前播放器，关闭预览立即释放源，其他视频不预加载', async () => {
    mockOverlayStyle()
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    const read = vi.spyOn(ownedVideos, 'readOwnedVideoUrl').mockResolvedValue({ url: 'https://r2.test/current.mp4' })
    const imageRead = vi.spyOn(ownedImages, 'readOwnedImage')
    const videos: PreviewItem[] = [1, 2].map(index => ({ id: `video-${index}`, mediaType: 'video', thumbSrc: '', fullSrc: '', objectKey: `video-${index}` }))
    const props = { items: videos, current: 0, onClose: vi.fn(), onChange: vi.fn() }
    const { rerender } = render(<App><PreviewGallery {...props} open /></App>)
    const video = await screen.findByLabelText('视频预览') as HTMLVideoElement
    await waitFor(() => expect(video.getAttribute('src')).toBe('https://r2.test/current.mp4'))
    expect(read).toHaveBeenCalledTimes(1)
    expect(imageRead).not.toHaveBeenCalled()
    expect(document.querySelectorAll('video')).toHaveLength(1)
    rerender(<App><PreviewGallery {...props} open={false} /></App>)
    expect(document.querySelector('video')).toBeNull()
    expect(video.pause).toHaveBeenCalled()
    expect(video.getAttribute('src')).toBeNull()
  })

  it('视频下载按钮在工具条内，不带图片操作项', async () => {
    mockOverlayStyle()
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    vi.spyOn(ownedVideos, 'readOwnedVideoUrl').mockResolvedValue({ url: 'https://r2.test/current.mp4' })
    const videos: PreviewItem[] = [{ id: 'video-1', mediaType: 'video', thumbSrc: '', fullSrc: '', objectKey: 'video-1' }]
    render(<App><PreviewGallery items={videos} open current={0} onClose={vi.fn()} onChange={vi.fn()} /></App>)
    const download = await screen.findByRole('button', { name: '下载视频' })
    const operations = document.querySelector('.ant-image-preview-operations')
    expect(operations?.contains(download)).toBe(true)
    expect(document.querySelector('.ant-image-preview-operations-operation-zoomIn')).toBeNull()
    expect(download.querySelector('.preview-toolbar-divider')).toBeNull()
    fireEvent.mouseEnter(download)
    expect(await screen.findByText('下载视频')).toBeTruthy()
  })

  it('历史预览下载直接复用当前 Blob，不再次读取完整历史', async () => {
    mockOverlayStyle()
    vi.spyOn(historyOwner, 'currentWorkstationHistoryOwner').mockReturnValue('anonymous')
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = vi.fn(() => 'blob:shared-preview')
      static revokeObjectURL = vi.fn()
    })
    const blob = new Blob(['图片'], { type: 'image/png' })
    const read = vi.spyOn(ownedImages, 'readOwnedImage').mockResolvedValue(blob)
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const history: PreviewItem[] = [{ id: 'history', historyId: 'history', thumbSrc: '', fullSrc: '', title: '商品.jpg' }]
    render(<App><PreviewGallery items={history} open current={0} onClose={vi.fn()} onChange={vi.fn()} /></App>)
    await waitFor(() => expect(document.querySelector('.ant-image-preview-img')?.getAttribute('src')).toBe('blob:shared-preview'))
    fireEvent.click(screen.getByRole('button', { name: '下载原始大图' }))
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
    expect(read).toHaveBeenCalledTimes(1)
    expect(URL.createObjectURL).toHaveBeenLastCalledWith(blob)
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalled(), { timeout: 1500 })
  })

  it('下载按钮在预览工具条内，位于放大按钮右侧', async () => {
    mockOverlayStyle()
    render(<App><PreviewGallery items={items} open current={0} onClose={vi.fn()} onChange={vi.fn()} /></App>)
    const download = await screen.findByRole('button', { name: '下载原始大图' })
    const operations = document.querySelector('.ant-image-preview-operations') as HTMLElement
    expect(operations.contains(download)).toBe(true)
    const actions = [...operations.querySelectorAll(':scope > .ant-image-preview-operations-operation')]
    expect(actions).toHaveLength(7)
    expect(actions[5].className).toContain('zoomIn')
    expect(actions[6]).toBe(download)
    expect(download.querySelector(':scope > .anticon')).toBeTruthy()
    expect(download.querySelector('.preview-toolbar-divider')).toBeTruthy()
    expect(operations.contains(screen.getByRole('button', { name: '对比原图与结果' }))).toBe(false)
    fireEvent.mouseEnter(download)
    expect(await screen.findByText('下载原图')).toBeTruthy()
  })

  it('账号切换后的旧历史不读取图片，也不调用自定义下载', async () => {
    mockOverlayStyle()
    vi.spyOn(historyOwner, 'isCurrentWorkstationHistoryOwner').mockReturnValue(false)
    const read = vi.spyOn(ownedImages, 'readOwnedImage')
    const download = vi.fn()
    const history: PreviewItem[] = [{ id: 'history', historyId: 'history', ownerId: 'old-owner', thumbSrc: '', fullSrc: '' }]
    render(<App><PreviewGallery items={history} open current={0} onClose={vi.fn()} onChange={vi.fn()} onDownload={download} /></App>)
    await screen.findByText('账号已切换，无法读取其他账号的图片')
    fireEvent.click(screen.getByRole('button', { name: '下载原始大图' }))
    await screen.findByText(/账号已切换，无法下载其他账号的图片/)
    expect(read).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
  })

  it('仅有源图时显示对比，并在切换到无源图结果时回到普通预览', async () => {
    mockOverlayStyle()
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
    mockOverlayStyle()
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
    mockOverlayStyle()
    render(<App><PreviewGallery items={items} open current={0} onClose={vi.fn()} onChange={vi.fn()} /></App>)
    const preview = await waitFor(() => document.querySelector('.ant-image-preview-img') as HTMLImageElement)
    expect(preview).toBeTruthy()
    expect(frameState(preview)).toBe('loading')
    expect(document.querySelector('.preview-load-state')).toBeTruthy()
    fireEvent.load(preview)
    await waitFor(() => expect(frameState(preview)).toBe('ready'))
    expect(document.querySelector('.preview-load-state')).toBeNull()
  })

  it('对比图用自己的 onLoad，加载完成后可见', async () => {
    mockOverlayStyle()
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
    mockOverlayStyle()
    render(<App><PreviewGallery items={items} open current={0} onClose={vi.fn()} onChange={vi.fn()} /></App>)
    const preview = await waitFor(() => document.querySelector('.ant-image-preview-img') as HTMLImageElement)
    fireEvent.error(preview)
    expect(await screen.findByText('图片加载失败')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }))
    const retried = await waitFor(() => document.querySelector('.ant-image-preview-img') as HTMLImageElement)
    expect(frameState(retried)).toBe('loading')
    fireEvent.load(retried)
    await waitFor(() => expect(frameState(retried)).toBe('ready'))
  })

  it('加载后点放大不抛错', async () => {
    mockOverlayStyle()
    render(<App><PreviewGallery items={items} open current={0} onClose={vi.fn()} onChange={vi.fn()} /></App>)
    const preview = await waitFor(() => document.querySelector('.ant-image-preview-img') as HTMLImageElement)
    stubPreviewMetrics(preview)
    fireEvent.load(preview)
    await waitFor(() => expect(frameState(preview)).toBe('ready'))
    expect(zoomInButton()).toBeTruthy()
    expect(() => fireEvent.click(zoomInButton())).not.toThrow()
  })

  it('打开预览、切换图片、缩放时不抛错且不 console.error', async () => {
    mockOverlayStyle()
    const tracker = collectConsoleErrors()
    const onChange = vi.fn()
    const { rerender } = render(<App><PreviewGallery items={items} open current={0} onClose={vi.fn()} onChange={onChange} /></App>)
    const first = await waitFor(() => document.querySelector('.ant-image-preview-img') as HTMLImageElement)
    stubPreviewMetrics(first)
    expect(() => fireEvent.click(zoomInButton())).not.toThrow()
    expect(() => fireEvent.wheel(first, { deltaY: -120 })).not.toThrow()
    fireEvent.load(first)
    await waitFor(() => expect(frameState(first)).toBe('ready'))
    expect(() => fireEvent.click(zoomInButton())).not.toThrow()

    fireEvent.click(document.querySelector('.ant-image-preview-switch-right') as HTMLElement)
    expect(onChange).toHaveBeenCalledWith(1)
    rerender(<App><PreviewGallery items={items} open current={1} onClose={vi.fn()} onChange={onChange} /></App>)

    const second = await waitFor(() => document.querySelector('.ant-image-preview-img') as HTMLImageElement)
    stubPreviewMetrics(second)
    expect(() => fireEvent.click(zoomInButton())).not.toThrow()
    expect(() => fireEvent.wheel(second, { deltaY: -80 })).not.toThrow()
    fireEvent.load(second)
    await waitFor(() => expect(frameState(second)).toBe('ready'))
    expect(() => fireEvent.click(zoomInButton())).not.toThrow()

    fireEvent.keyDown(window, { key: 'ArrowLeft', keyCode: 37, which: 37 })
    rerender(<App><PreviewGallery items={items} open current={0} onClose={vi.fn()} onChange={onChange} /></App>)
    const back = await waitFor(() => document.querySelector('.ant-image-preview-img') as HTMLImageElement)
    stubPreviewMetrics(back)
    expect(() => fireEvent.wheel(back, { deltaY: 80 })).not.toThrow()
    fireEvent.load(back)
    await waitFor(() => expect(frameState(back)).toBe('ready'))

    tracker.restore()
    expect(tracker.errors.filter(message => /width|preventDefault|TypeError/i.test(message))).toEqual([])
  })

  it('对比滚轮挂在非 passive 的 capture 监听上', async () => {
    mockOverlayStyle()
    const original = EventTarget.prototype.addEventListener
    const wheelAdds: AddEventListenerOptions[] = []
    vi.spyOn(EventTarget.prototype, 'addEventListener').mockImplementation(function (this: EventTarget, type, listener, options) {
      if (type === 'wheel' && this instanceof Element && (this.classList.contains('compare-stage') || this.classList.contains('ant-modal-wrap'))) {
        wheelAdds.push(typeof options === 'boolean' ? { capture: options } : { ...(options ?? {}) })
      }
      return original.call(this, type, listener, options)
    })
    render(<App><PreviewGallery items={items} open current={0} onClose={vi.fn()} onChange={vi.fn()} /></App>)
    fireEvent.click(await screen.findByRole('button', { name: '对比原图与结果' }))
    const stage = document.querySelector('.compare-stage') as HTMLElement
    expect(stage).toBeTruthy()
    expect(stage.getAttribute('onwheel')).toBeNull()
    expect(wheelAdds.some(options => options.passive === false && options.capture === true)).toBe(true)
    const event = new WheelEvent('wheel', { deltaY: -100, cancelable: true, bubbles: true })
    expect(stage.dispatchEvent(event)).toBe(false)
    expect(event.defaultPrevented).toBe(true)
  })
})
