import { describe, expect, it, vi } from 'vitest'
import { mattingFromUrl, signedMattingRequest } from './tencent-matting'

const config = { secretId: 'test-id', secretKey: 'test-key', bucket: 'example-1250000000', region: 'ap-guangzhou' }
const sourceUrl = 'https://r2.test/图片.jpg?X-Amz-Credential=a%2Fb&X-Amz-Signature=test&name=a%20b'

describe('腾讯直接读取 R2 签名地址', () => {
  it('签名包含源地址和 host，查询参数只编码一次', () => {
    const signed = signedMattingRequest(sourceUrl, config)
    const url = new URL(signed.url)
    expect(url.pathname).toBe('/')
    expect(url.searchParams.get('detect-url')).toBe(sourceUrl)
    expect(url.searchParams.get('center-layout')).toBe('0')
    const signature = new URLSearchParams(signed.headers.Authorization)
    expect(signature.get('q-url-param-list')).toBe('center-layout;ci-process;detect-url')
    expect(signature.get('q-header-list')).toBe('host')
  })
  it('一次 GET 获取 PNG 并分别记录等待和下载耗时', async () => {
    const fetch = vi.fn(async () => new Response('png', { headers: { 'Content-Type': 'image/png', 'x-cos-request-id': 'cos-id' } }))
    const log = vi.fn()
    expect((await mattingFromUrl(sourceUrl, { deadlineAt: Date.now() + 1000, config, fetch, log })).toString()).toBe('png')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]).toEqual([expect.stringContaining('ci-process=GoodsMatting'), expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) })])
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ stage: 'providerTtfb', upstreamRequestId: 'cos-id' }))
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ stage: 'providerDownload', bytes: 3 }))
  })
  it('权限错误不重复调用，响应内容和签名不进入日志', async () => {
    const fetch = vi.fn(async () => new Response('包含签名的错误内容', { status: 403 }))
    const log = vi.fn()
    await expect(mattingFromUrl(sourceUrl, { deadlineAt: Date.now() + 1000, config, fetch, log })).rejects.toMatchObject({ code: 'BG_REMOVE_FAILED', status: 502 })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(log.mock.calls)).not.toContain('Signature')
  })
  it('拒绝超大响应及非 PNG，遇到传输错误提供稳定错误码', async () => {
    const fetch = vi.fn(async () => new Response('png', { headers: { 'Content-Type': 'image/png', 'Content-Length': String(128 * 1024 * 1024 + 1) } }))
    await expect(mattingFromUrl(sourceUrl, { deadlineAt: Date.now() + 1000, config, fetch })).rejects.toMatchObject({ code: 'BG_REMOVE_INVALID_RESULT' })
    fetch.mockResolvedValue(new Response('{}', { headers: { 'Content-Type': 'application/json' } }))
    await expect(mattingFromUrl(sourceUrl, { deadlineAt: Date.now() + 1000, config, fetch })).rejects.toMatchObject({ code: 'BG_REMOVE_INVALID_RESULT' })
    fetch.mockRejectedValue(new Error(`fetch failed: ${sourceUrl}`))
    await expect(mattingFromUrl(sourceUrl, { deadlineAt: Date.now() + 1000, config, fetch })).rejects.toMatchObject({ message: '无法连接腾讯抠图服务，请稍后重试' })
  })
  it('未配置和预算用尽时不发请求', async () => {
    const fetch = vi.fn()
    await expect(mattingFromUrl(sourceUrl, { deadlineAt: Date.now() + 1000, config: null, fetch })).rejects.toMatchObject({ status: 503 })
    await expect(mattingFromUrl(sourceUrl, { deadlineAt: Date.now() - 1, config, fetch })).rejects.toMatchObject({ status: 504 })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('供应商请求超时后不重复提交', async () => {
    const fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('超时', 'AbortError')), { once: true })
    }))
    await expect(mattingFromUrl(sourceUrl, { deadlineAt: Date.now() + 30, config, fetch })).rejects.toMatchObject({ status: 504, code: 'BG_REMOVE_TIMEOUT' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
