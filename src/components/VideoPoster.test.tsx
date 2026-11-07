// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as ownedVideos from '@/services/api/ownedVideos'
import VideoPoster from './VideoPoster'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('视频海报', () => {
  it('封面变体：海报加载后同时渲染铺底与海报', async () => {
    vi.spyOn(ownedVideos, 'readOwnedVideoUrl').mockResolvedValue({ url: 'https://r2.test/poster.jpg' })
    const { container } = render(<VideoPoster posterKey="poster.jpg" ownerId="anonymous" variant="cover" />)

    expect(await screen.findByRole('img', { name: '视频封面' })).toBeTruthy()
    expect(container.querySelector('.cover-backdrop')?.getAttribute('src')).toBe('https://r2.test/poster.jpg')
  })

  it('封面变体：取不到海报时用统一占位', async () => {
    vi.spyOn(ownedVideos, 'readOwnedVideoUrl').mockRejectedValue(new Error('不可用'))
    const { container } = render(<VideoPoster posterKey="poster.jpg" ownerId="anonymous" variant="cover" />)

    await waitFor(() => expect(container.querySelector('.cover-placeholder')).toBeTruthy())
    expect(container.querySelector('.cover-backdrop')).toBeNull()
    expect(container.querySelector('.preview-video-poster')).toBeNull()
  })

  it('封面变体：海报加载失败后回到占位', async () => {
    vi.spyOn(ownedVideos, 'readOwnedVideoUrl').mockResolvedValue({ url: 'https://r2.test/poster.jpg' })
    const { container } = render(<VideoPoster posterKey="poster.jpg" ownerId="anonymous" variant="cover" />)

    fireEvent.error(await screen.findByRole('img', { name: '视频封面' }))
    await waitFor(() => expect(container.querySelector('.cover-placeholder')).toBeTruthy())
    expect(container.querySelector('.cover-backdrop')).toBeNull()
  })

  it('结果条变体保持原有深绿占位', () => {
    vi.spyOn(ownedVideos, 'readOwnedVideoUrl').mockRejectedValue(new Error('不可用'))
    const { container } = render(<VideoPoster posterKey="poster.jpg" ownerId="anonymous" />)

    expect(container.querySelector('.preview-video-poster')?.textContent).toContain('视频')
    expect(container.querySelector('.cover-placeholder')).toBeNull()
  })
})
