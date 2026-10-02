// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SMART_SELECT_RETRY_MESSAGE,
  SMART_SELECT_TIMEOUT_MESSAGE,
  clearSmartSelectSessionCache,
  cachedSmartSelectSession,
  isSmartSelectTimeout,
  smartSelectErrorMessage,
  storeSmartSelectSession,
  SmartSelectRequestError,
  requestSmartSelect,
} from './smartSelect'

describe('智能选区错误与缓存', () => {
  beforeEach(() => {
    clearSmartSelectSessionCache()
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

  it('超时和中止显示可重试文案，而不是空白 toast', () => {
    expect(isSmartSelectTimeout(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }))).toBe(true)
    expect(isSmartSelectTimeout(new DOMException('The user aborted a request', 'AbortError'))).toBe(true)
    expect(smartSelectErrorMessage(Object.assign(new Error('signal timed out'), { name: 'TimeoutError' }))).toBe(SMART_SELECT_TIMEOUT_MESSAGE)
    expect(smartSelectErrorMessage(new SmartSelectRequestError('没有点中商品，请点在商品上。水印和文字请用画笔', 'SMART_SELECT_MISS'))).toBe('没有点中商品，请点在商品上。水印和文字请用画笔')
    expect(smartSelectErrorMessage(new Error(''))).toBe(SMART_SELECT_RETRY_MESSAGE)
  })

  it('同一张图记住 session，第二次点击不再带原图', async () => {
    const session = { provider: 'tencent-goods', payload: '{"v":1}' }
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { dataBase64?: string; session?: { payload: string } }
      expect(body.session).toEqual(session)
      expect(body.dataBase64).toBeUndefined()
      return new Response(JSON.stringify({
        maskBase64: 'iVBORw0KGgo=',
        width: 32,
        height: 32,
        bbox: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 },
        session,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    storeSmartSelectSession('https://img/coffee.jpg', session)
    expect(cachedSmartSelectSession('https://img/coffee.jpg')).toEqual(session)

    await requestSmartSelect({
      imageUrl: 'https://img/coffee.jpg',
      naturalSize: { width: 1280, height: 1280 },
      point: { x: 0.4, y: 0.5 },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('接口超时把 AbortError 转成可重试中文提示', async () => {
    storeSmartSelectSession('https://img/headphones.jpg', { provider: 'tencent-goods', payload: '{"v":1}' })
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
    }))
    await expect(requestSmartSelect({
      imageUrl: 'https://img/headphones.jpg',
      naturalSize: { width: 1280, height: 2014 },
      point: { x: 0.5, y: 0.5 },
    })).rejects.toMatchObject({ message: SMART_SELECT_TIMEOUT_MESSAGE })
  })
  it('记录会话 POST 的真实 JSON 字节，日志不包含会话或令牌', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    const session = { provider: 'tencent-goods', payload: '私有会话内容' }
    storeSmartSelectSession('https://img/private.jpg', session)
    let sent = ''
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      sent = String(init.body)
      return new Response(JSON.stringify({ maskBase64: 'png', width: 32, height: 32, bbox: { x: 0, y: 0, width: 0.5, height: 0.5 }, session, requestId: 'request-id' }))
    }))
    await requestSmartSelect({ imageUrl: 'https://img/private.jpg', naturalSize: { width: 32, height: 32 }, point: { x: 0.2, y: 0.2 } })
    expect(debug).toHaveBeenCalledWith('[智能选区]', expect.objectContaining({ operation: 'post', source: 'session', requestCount: 1, requestBytes: new TextEncoder().encode(sent).byteLength, responseReadMs: expect.any(Number), requestId: 'request-id' }))
    expect(debug).toHaveBeenCalledWith('[智能选区]', expect.objectContaining({ operation: 'complete', requestCount: 1, outcome: 'success' }))
    expect(JSON.stringify(debug.mock.calls)).not.toMatch(/私有会话内容|https:|maskBase64|Authorization/)
  })

})
