import { describe, expect, it, vi } from 'vitest'
import { downloadVideoResult, publicVideoAddress } from './download.js'
const ctx = () => ({ fetch: vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))), now: Date.now, sleep: vi.fn(), log: vi.fn() })
describe('Gateway 视频结果下载', () => {
  it('拒绝私网、映射地址、非 HTTPS 和携带凭证的地址', async () => {
    for (const ip of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1']) expect(publicVideoAddress(ip)).toBe(false)
    expect(publicVideoAddress('8.8.8.8')).toBe(true)
    const context = ctx()
    for (const url of ['https://127.0.0.1/a', 'https://[::1]/a', 'http://cdn.example.com/a', 'https://user:pass@cdn.example.com/a']) {
      await expect(downloadVideoResult(url, context)).rejects.toMatchObject({ code: 'VIDEO_RESULT_INVALID' })
    }
    expect(context.fetch).not.toHaveBeenCalled()
  })
  it('下载限制字节数，禁止重定向，并在实际连接时检查解析地址', async () => {
    const context = ctx()
    await expect(downloadVideoResult('https://cdn.example.com/a', context)).resolves.toEqual(Buffer.from([1, 2, 3]))
    expect(context.fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: 'error', dispatcher: expect.any(Object) }))
    await expect(downloadVideoResult('https://cdn.example.com/a', context, 2)).rejects.toMatchObject({ code: 'VIDEO_RESULT_TOO_LARGE' })
  })
})
