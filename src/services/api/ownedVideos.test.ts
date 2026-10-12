// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
const signed = vi.hoisted(() => vi.fn())
vi.mock('./objects', () => ({ signedOwnedObject: signed }))
vi.mock('@/features/assets/historyOwner', () => ({
  currentWorkstationHistoryOwner: () => '测试账号',
  isCurrentWorkstationHistoryOwner: () => true,
}))
import { downloadOwnedVideo } from './ownedVideos'
afterEach(() => {
  vi.restoreAllMocks()
  signed.mockReset()
})
describe('任务视频下载会话保护', () => {
  it('同账号切换环境后，迟到签名不触发下载', async () => {
    let current = true,
      complete!: (value: { url: string }) => void
    signed.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)
    const signal = new AbortController().signal
    const download = downloadOwnedVideo(
      { objectKey: 'owned/video' },
      '结果.mp4',
      '测试账号',
      { signal, isCurrent: () => current },
    )
    const rejected = expect(download).rejects.toThrow('环境已切换')
    expect(signed).toHaveBeenCalledWith('owned/video', signal, '结果.mp4')
    current = false
    complete({ url: 'https://storage.test/video' })
    await rejected
    expect(click).not.toHaveBeenCalled()
  })
  it('取消后不再读取签名，当前会话可下载已有结果', async () => {
    const aborted = new AbortController()
    aborted.abort()
    await expect(
      downloadOwnedVideo({ objectKey: 'owned/video' }, '结果.mp4', '测试账号', {
        signal: aborted.signal,
      }),
    ).rejects.toThrow()
    expect(signed).not.toHaveBeenCalled()
    signed.mockResolvedValue({ url: 'https://storage.test/video' })
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)
    await downloadOwnedVideo(
      { objectKey: 'owned/video' },
      '结果.mp4',
      '测试账号',
      { isCurrent: () => true },
    )
    expect(click).toHaveBeenCalledOnce()
  })
})
