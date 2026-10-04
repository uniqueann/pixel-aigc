// @vitest-environment jsdom

import { clearOwnedImageSession } from '@/services/api/ownedImages'
vi.mock('@/features/assets/historyOwner', () => ({ currentWorkstationHistoryOwner: () => 'u' }))
import { useUserStore } from '@/store/useUserStore'
vi.mock('@/services/api/billing', () => ({
  authorizeSyncQuote: async (_operation: string, maxCredits: number) => ({ requestId: '00000000-0000-4000-8000-000000000100', priceVersion: 'aigc-sync-v1', maxCredits, owner: 'u' }),
  refreshBillingBalance: async () => {}, openCreditRecharge: vi.fn(), recoverSyncResult: async () => null,
}))
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ uploadTaskInput: vi.fn(), signedOwnedObjectUrl: vi.fn() }))
vi.mock('./upload', () => ({ uploadTaskInput: mocks.uploadTaskInput }))
vi.mock('./objects', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./objects')>()
  return {
    ...actual,
    signedOwnedObject: (...args: unknown[]) => mocks.signedOwnedObjectUrl(...args).then((url: string) => ({ url, expiresAt: Date.now() + 60_000 })),
  }
})
import { requestRepaint } from './repaint'
import { requestOutpaint } from './outpaint'

beforeEach(() => {
  useUserStore.getState().setUser('u', 'free')
  clearOwnedImageSession()
  mocks.uploadTaskInput.mockReset()
  mocks.signedOwnedObjectUrl.mockReset()
  if (typeof AbortSignal.timeout !== 'function') {
    Object.defineProperty(AbortSignal, 'timeout', {
      configurable: true,
      value: () => new AbortController().signal,
    })
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('重绘与扩图的大图请求', () => {
  it('重绘复用已有原图键，只上传蒙版并经同源代理读取结果', async () => {
    mocks.uploadTaskInput.mockResolvedValue('temporary/task-inputs/user/mask')
    mocks.signedOwnedObjectUrl.mockResolvedValue('https://r2.test/refreshed')
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/repaint') return new Response(JSON.stringify({
        objectKey: 'temporary/repaint-results/user/1.jpg', mimeType: 'image/jpeg', url: 'https://r2.test/expired',
      }), { headers: { 'Content-Type': 'application/json' } })
      if (url.endsWith('/expired')) return new Response('', { status: 403 })
      return new Response(new Uint8Array([255, 216, 255]), {
        headers: { 'Content-Type': 'image/jpeg' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await requestRepaint(null, 'data:image/png;base64,QUFB', '桌上的花瓶', 'generated/user/job/0.png')
    const [, init] = fetchMock.mock.calls.find(call => call[0] === '/api/repaint') as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({
      sourceImageKey: 'generated/user/job/0.png', maskImageKey: 'temporary/task-inputs/user/mask', prompt: '桌上的花瓶',
    })
    expect(mocks.uploadTaskInput).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/objects'))).toBe(true)
    expect(mocks.signedOwnedObjectUrl).not.toHaveBeenCalled()
    expect(result.type).toBe('image/jpeg')
  })

  it('工具箱缩放后的大图上传 R2，扩图接口只接收对象键', async () => {
    mocks.uploadTaskInput.mockResolvedValue('temporary/task-inputs/user/scaled')
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([255, 216, 255]), {
      headers: { 'Content-Type': 'image/jpeg' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const input = new Blob([new Uint8Array([255, 216, 255]), new Uint8Array(3 * 1024 * 1024 - 3)], { type: 'image/jpeg' })
    await requestOutpaint(input, 'image/jpeg', { left: 100, right: 0, top: 0, bottom: 0 })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.sourceImageKey).toBe('temporary/task-inputs/user/scaled')
    expect(body.dataBase64).toBeUndefined()
    expect(mocks.uploadTaskInput).toHaveBeenCalledWith(input, 'image/jpeg', expect.any(AbortSignal))
  })

  it('图片工作站未缩放的扩图直接复用原图键', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([255, 216, 255]), {
      headers: { 'Content-Type': 'image/jpeg' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    await requestOutpaint(null, 'image/jpeg', { left: 50, right: 0, top: 0, bottom: 0 }, 'generated/user/job/0.png')
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({ sourceImageKey: 'generated/user/job/0.png' })
    expect(mocks.uploadTaskInput).not.toHaveBeenCalled()
  })
})
