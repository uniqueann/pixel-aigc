import { createHmac, randomBytes } from 'node:crypto'
import { IncomingMessage } from 'node:http'
import { Socket } from 'node:net'
import { PassThrough, Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyPaymentEvent } from './payments/providers'
import { readRequestBody } from './request-body'
import type { VercelRequest } from './http'

describe('原始请求体', () => {
  it('保留流中中文、空格和换行，用于支付签名', async () => {
    const body = '{ "title": "充值" }\n', req = Readable.from([Buffer.from(body)]) as VercelRequest
    await readRequestBody(req, 1024)
    expect(req.rawBody).toBe(body); expect(req.body).toBe(body)
  })
  it('Buffer请求体转换为原始文本供普通JSON路由解析', async () => {
    const req = { body: Buffer.from('{"amount":199}') } as VercelRequest
    await readRequestBody(req, 1024); expect(req.body).toBe('{"amount":199}')
  })
  it('超过大小限制的流立即拒绝，已解析对象不伪造原始签名体', async () => {
    const req = Readable.from([Buffer.alloc(2048)]) as VercelRequest
    await expect(readRequestBody(req, 1024)).rejects.toMatchObject({ status: 413 })
    const parsed = { body: { amount: 199 } } as VercelRequest
    await readRequestBody(parsed, 1024); expect(parsed.rawBody).toBeUndefined()
  })
})

/** 复刻 @vercel/node restoreBody：只回放 req.read 和 data/end。 */
function restoreBody(req: IncomingMessage, body: Buffer) {
  const replicate = new PassThrough()
  const originalOn = req.on.bind(req)
  const patched = (event: string, listener: (...args: unknown[]) => void) => {
    if (event === 'data' || event === 'end') replicate.on(event, listener)
    else originalOn(event as 'error', listener as () => void)
    return req
  }
  req.on = patched as typeof req.on
  req.addListener = patched as typeof req.addListener
  req.read = replicate.read.bind(replicate) as typeof req.read
  replicate.write(body)
  replicate.end()
}

/**
 * 模拟 Vercel Node：先排空原流，再回放原始字节，并把 application/json 的 req.body 做成惰性 getter。
 * 访问 getter 会 JSON.parse，且异步迭代看不到回放。
 */
async function vercelJsonRequest(raw: string) {
  const req = new IncomingMessage(new Socket())
  req.method = 'POST'
  req.url = '/api/payments/dodo/webhook'
  req.headers['content-type'] = 'application/json'
  const bytes = Buffer.from(raw)
  req.push(bytes)
  req.push(null)
  await new Promise<void>((resolve, reject) => {
    req.on('data', () => {})
    req.on('end', () => resolve())
    req.on('error', reject)
  })
  restoreBody(req, bytes)
  let getterReads = 0
  Object.defineProperty(req, 'body', {
    configurable: true,
    enumerable: true,
    get() {
      getterReads += 1
      const value: unknown = JSON.parse(bytes.toString('utf8'))
      Object.defineProperty(req, 'body', { configurable: true, enumerable: true, writable: true, value })
      return value
    },
    set(value: unknown) {
      Object.defineProperty(req, 'body', { configurable: true, enumerable: true, writable: true, value })
    },
  })
  return { req: req as VercelRequest, getterReads: () => getterReads }
}

function signCreem(body: string) {
  return { 'creem-signature': createHmac('sha256', 'test_secret').update(body).digest('hex') }
}
function signDodo(body: string) {
  const key = randomBytes(32)
  vi.stubEnv('AIGC_DODO_TEST_WEBHOOK_SECRET', `whsec_${key.toString('base64')}`)
  const id = 'msg_raw', timestamp = String(Math.floor(Date.now() / 1000))
  const signature = `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`
  return { 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': signature }
}

describe('Vercel application/json 原始验签体', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('惰性 getter 尚未访问时保留空格、换行和中文，Dodo 与 Creem 验签通过', async () => {
    vi.stubEnv('AIGC_RUNTIME_SCOPE', 'preview')
    vi.stubEnv('AIGC_CREEM_TEST_API_KEY', 'test_key')
    vi.stubEnv('AIGC_CREEM_TEST_WEBHOOK_SECRET', 'test_secret')
    vi.stubEnv('AIGC_DODO_TEST_API_KEY', 'test_key')
    const raw = '{ "type": "payment.succeeded", "data": { "title": "充值" } }\n'
    expect(JSON.stringify(JSON.parse(raw))).not.toBe(raw)
    const { req, getterReads } = await vercelJsonRequest(raw)
    await readRequestBody(req, 1024)
    expect(getterReads()).toBe(0)
    expect(req.rawBody).toBe(raw)
    expect(req.headers['content-type']).toBe('application/json')
    const parsed = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    expect(parsed).toEqual({ type: 'payment.succeeded', data: { title: '充值' } })
    expect(verifyPaymentEvent('creem', req.rawBody!, signCreem(req.rawBody!)).type).toBe('payment.succeeded')
    expect(verifyPaymentEvent('dodo', req.rawBody!, signDodo(req.rawBody!)).type).toBe('payment.succeeded')
    expect(() => verifyPaymentEvent('creem', JSON.stringify(JSON.parse(raw)), signCreem(raw))).toThrow('支付回调签名无效')
  })

  it('getter 已经把 JSON 解析成对象后，回放字节仍能通过验签', async () => {
    vi.stubEnv('AIGC_RUNTIME_SCOPE', 'preview')
    vi.stubEnv('AIGC_CREEM_TEST_WEBHOOK_SECRET', 'test_secret')
    vi.stubEnv('AIGC_DODO_TEST_API_KEY', 'test_key')
    const raw = '{ "eventType": "checkout.completed", "id": "evt_raw", "object": { "title": "充值" } }\n'
    const { req, getterReads } = await vercelJsonRequest(raw)
    expect(req.body).toEqual(JSON.parse(raw))
    expect(getterReads()).toBe(1)
    await readRequestBody(req, 4096)
    expect(getterReads()).toBe(1)
    expect(req.rawBody).toBe(raw)
    expect(JSON.stringify(JSON.parse(raw))).not.toBe(req.rawBody)
    expect(verifyPaymentEvent('creem', req.rawBody!, signCreem(req.rawBody!)).id).toBe('evt_raw')
    expect(verifyPaymentEvent('dodo', req.rawBody!, signDodo(req.rawBody!)).eventType).toBe('checkout.completed')
  })

  it('回放体超过路由大小限制时拒绝，且不触发 JSON 解析', async () => {
    const { req, getterReads } = await vercelJsonRequest(`{"blob":"${'a'.repeat(2048)}"}`)
    await expect(readRequestBody(req, 1024)).rejects.toMatchObject({ status: 413 })
    expect(getterReads()).toBe(0)
    expect(req.rawBody).toBeUndefined()
  })
})
