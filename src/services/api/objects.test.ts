// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/cloud/client', () => ({ authEnabled: false, supabase: null }))
import { fetchOwnedObjectDirect } from './objects'

afterEach(() => vi.unstubAllGlobals())

describe('私有对象直读', () => {
  it('签名地址跨域失败时只刷新一次，不回退图片代理', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('mode=url')) return new Response(JSON.stringify({ url: 'https://r2.test/source' }))
      if (url.startsWith('https://r2.test/')) throw new TypeError('Failed to fetch')
      return new Response('image', { headers: { 'Content-Type': 'image/jpeg' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchOwnedObjectDirect('generated/owner/job/0.jpg')).rejects.toThrow('读取结果中断')
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock.mock.calls.every(([url]) => url.startsWith('https://') || url.includes('mode=url'))).toBe(true)
  })
})
