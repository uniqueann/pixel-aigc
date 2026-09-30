// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/cloud/client', () => ({ authEnabled: false, supabase: null }))
import { fetchOwnedObjectDirect } from './objects'

afterEach(() => vi.unstubAllGlobals())

describe('私有对象直读', () => {
  it('签名地址受浏览器跨域限制时回退到现有对象接口', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('mode=url')) return new Response(JSON.stringify({ url: 'https://r2.test/source' }))
      if (url.startsWith('https://r2.test/')) throw new TypeError('Failed to fetch')
      return new Response('image', { headers: { 'Content-Type': 'image/jpeg' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const blob = await fetchOwnedObjectDirect('generated/owner/job/0.jpg')
    expect(blob.size).toBe(5)
    expect(blob.type).toBe('image/jpeg')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
