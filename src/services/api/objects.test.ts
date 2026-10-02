// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/cloud/client', () => ({ authEnabled: false, supabase: null }))
import { fetchOwnedObjectDirect } from './objects'

afterEach(() => vi.unstubAllGlobals())

describe('私有对象直读', () => {
  it('字节读取走同源代理，不直连签名地址', async () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/objects') && !String(url).includes('mode=url')) {
        return new Response(png, { headers: { 'Content-Type': 'image/png' } })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const blob = await fetchOwnedObjectDirect('generated/owner/job/0.jpg')
    expect(blob.size).toBe(png.length)
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith('/api/objects') && !String(url).includes('mode=url'))).toBe(true)
  })
})
