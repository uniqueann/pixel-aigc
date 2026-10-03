// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUserStore } from '@/store/useUserStore'
import VideoPlayer from './VideoPlayer'

const OWNER = '11111111-1111-4111-8111-111111111111'
const signed = vi.hoisted(() => vi.fn())
vi.mock('@/cloud/client', () => ({ authEnabled: true }))
vi.mock('@/services/api/objects', () => ({ signedOwnedObject: signed }))
beforeEach(() => {
  useUserStore.setState({ userId: OWNER })
  signed.mockReset().mockResolvedValue({ url: 'https://r2.test/video', expiresAt: Date.now() + 900_000 })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); useUserStore.setState({ userId: null }) })

describe('共用视频播放器', () => {
  it('只请求签名地址，关闭时暂停并释放源，默认不预加载视频字节', async () => {
    const { unmount } = render(<VideoPlayer reference={{ objectKey: 'video-key' }} ownerId={OWNER} />)
    const video = screen.getByLabelText('视频预览') as HTMLVideoElement
    await waitFor(() => expect(video.src).toBe('https://r2.test/video'))
    expect(video.preload).toBe('none')
    expect(signed).toHaveBeenCalledTimes(1)
    unmount()
    expect(video.pause).toHaveBeenCalled()
    expect(video.getAttribute('src')).toBeNull()
    expect(video.load).toHaveBeenCalled()
  })
  it('账号切换清空旧源，不读取其他账号的视频', async () => {
    render(<VideoPlayer reference={{ objectKey: 'video-key' }} ownerId={OWNER} />)
    await waitFor(() => expect((screen.getByLabelText('视频预览') as HTMLVideoElement).src).toBe('https://r2.test/video'))
    await act(async () => useUserStore.setState({ userId: '22222222-2222-4222-8222-222222222222' }))
    await screen.findByText('账号已切换，无法读取视频')
    expect(screen.getByLabelText('视频预览').getAttribute('src')).toBeNull()
    expect(signed).toHaveBeenCalledTimes(1)
  })
  it('签名到期前续签；超过保留期后不继续获取地址', async () => {
    vi.useFakeTimers()
    signed.mockImplementation(async () => ({ url: 'https://r2.test/video', expiresAt: Date.now() + 2000 }))
    const expiry = new Date(Date.now() + 3000).toISOString()
    await act(async () => render(<VideoPlayer reference={{ objectKey: 'video-key', retentionExpiresAt: expiry }} ownerId={OWNER} />))
    await act(async () => vi.advanceTimersByTime(1000))
    expect(signed).toHaveBeenCalledTimes(2)
    await act(async () => vi.advanceTimersByTime(2000))
    expect(screen.getByRole('alert').textContent).toContain('视频已过期')
    expect(screen.getByLabelText('视频预览').getAttribute('src')).toBeNull()
    const count = signed.mock.calls.length
    await act(async () => vi.advanceTimersByTime(60_000))
    expect(signed).toHaveBeenCalledTimes(count)
  })
})
