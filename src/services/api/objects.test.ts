// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/cloud/client', () => ({ authEnabled: false, supabase: null }))
import { fetchOwnedObject, fetchOwnedObjectDirect, signedOwnedObject } from './objects'

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

function errorResponse(status: number, body?: unknown) {
  if (body === undefined) return new Response('', { status })
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('私有对象错误文案', () => {
  it('对象错误只显示嵌套句子', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errorResponse(404, {
      error: { message: '结果对象不存在', token: 'secret-token' },
    })))
    await expect(fetchOwnedObject('generated/u/a.png')).rejects.toMatchObject({
      status: 404,
      message: '结果对象不存在',
    })
  })

  it('没有可用 message 时使用读取失败回退，空的 413 同样不展示对象', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errorResponse(413, { error: { token: 'secret-token' } })))
    await expect(fetchOwnedObject('generated/u/a.png')).rejects.toMatchObject({
      status: 413,
      message: '读取结果失败，请重试读取',
    })
    vi.stubGlobal('fetch', vi.fn(async () => errorResponse(413)))
    await expect(signedOwnedObject('generated/u/a.png')).rejects.toMatchObject({
      status: 413,
      message: '读取图片地址失败',
    })
  })

  it('保留字符串错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errorResponse(413, { error: '图片大小不能超过 20 MB' })))
    await expect(fetchOwnedObject('generated/u/a.png')).rejects.toMatchObject({
      status: 413,
      message: '图片大小不能超过 20 MB',
    })
  })
})
