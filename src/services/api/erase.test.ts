import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestErase } from './erase'

describe('消除客户端请求', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('POST /api/erase 带底图、蒙版和可选背景描述', async () => {
    const fetchMock = vi.fn(async () => new Response(new Blob([new Uint8Array([1])], { type: 'image/jpeg' }), {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const image = new Blob([new Uint8Array([9, 8, 7])], { type: 'image/jpeg' })
    await requestErase(image, 'image/jpeg', 'data:image/png;base64,QUFB', '浅色墙面')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/erase')
    const body = JSON.parse(String(init.body)) as {
      mimeType: string
      dataBase64: string
      maskMimeType: string
      maskBase64: string
      prompt: string
    }
    expect(body).toMatchObject({
      mimeType: 'image/jpeg',
      maskMimeType: 'image/png',
      maskBase64: 'QUFB',
      prompt: '浅色墙面',
    })
    expect(body.dataBase64.length).toBeGreaterThan(0)
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})
