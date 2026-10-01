// @vitest-environment jsdom

import { clearOwnedImageSession } from '@/services/api/ownedImages'
vi.mock('@/features/assets/historyOwner', () => ({ currentWorkstationHistoryOwner: () => 'u' }))
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ uploadTaskInput: vi.fn(), signedOwnedObjectUrl: vi.fn() }))
vi.mock('./upload', () => ({ uploadTaskInput: mocks.uploadTaskInput }))
vi.mock('./objects', () => ({ signedOwnedObject: (...args: unknown[]) => mocks.signedOwnedObjectUrl(...args).then((url: string) => ({ url, expiresAt: Date.now() + 60_000 })) }))
import { requestErase, shouldUseInlineEraseTransport } from './erase'

describe('消除客户端请求', () => {
  beforeEach(() => {
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

  it('POST /api/erase 带底图、蒙版和可选背景描述', async () => {
    const fetchMock = vi.fn(async () => new Response(new Blob([new Uint8Array([1])], { type: 'image/jpeg' }), {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const image = new Blob([new Uint8Array([255, 216, 255])], { type: 'image/jpeg' })
    await requestErase(image, 'image/jpeg', 'data:image/png;base64,QUFB', '浅色墙面')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/erase')
    const body = JSON.parse(String(init.body)) as {
      mimeType: string
      dataBase64: string
      maskMimeType: string
      maskBase64: string
      prompt: string
    }
    expect(body.mimeType).toBe('image/jpeg')
    expect(body.maskMimeType).toBe('image/png')
    expect(body.maskBase64).toBe('QUFB')
    expect(body.prompt).toBe('浅色墙面')
    expect(body.dataBase64.length).toBeGreaterThan(0)
    expect(mocks.uploadTaskInput).not.toHaveBeenCalled()
  })

  it('超过安全阈值或已有对象键时改走对象路径', () => {
    expect(shouldUseInlineEraseTransport(1024, 1024, '')).toBe(true)
    expect(shouldUseInlineEraseTransport(3 * 1024 * 1024, 1024, '')).toBe(false)
    expect(shouldUseInlineEraseTransport(1024, 1024, '', 'generated/user/job/0.png')).toBe(false)
  })

  it('大图并行上传原图与蒙版，并从签名地址读取大结果', async () => {
    mocks.uploadTaskInput.mockResolvedValueOnce('temporary/task-inputs/user/source')
      .mockResolvedValueOnce('temporary/task-inputs/user/mask')
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/erase') return new Response(JSON.stringify({
        objectKey: 'temporary/erase-results/user/1.jpg', mimeType: 'image/jpeg', url: 'https://r2.test/result',
      }), { headers: { 'Content-Type': 'application/json' } })
      return new Response(new Uint8Array([255, 216, 255]), {
        headers: { 'Content-Type': 'image/jpeg' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await requestErase(new Blob([new Uint8Array([255, 216, 255]), new Uint8Array(3 * 1024 * 1024 - 3)], { type: 'image/jpeg' }),
      'image/jpeg', 'data:image/png;base64,QUFB', '移除物体')
    expect(result.type).toBe('image/jpeg')
    expect(mocks.uploadTaskInput).toHaveBeenCalledTimes(2)
    const apiCall = fetchMock.mock.calls.find(call => call[0] === '/api/erase') as unknown as [string, RequestInit]
    expect(JSON.parse(String(apiCall[1].body))).toMatchObject({
      sourceImageKey: 'temporary/task-inputs/user/source', maskImageKey: 'temporary/task-inputs/user/mask', prompt: '移除物体',
    })
    expect(fetchMock).toHaveBeenCalledWith('https://r2.test/result', expect.any(Object))
  })
})
