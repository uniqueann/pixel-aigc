import type { IncomingMessage } from 'node:http'
import type { VercelRequest } from './http.js'
import { HttpError } from './errors.js'

/**
 * 读取验签用的原始字节。
 *
 * @vercel/node 的 addHelpers 会先把请求流读完，再把 req.body 设成惰性 getter：
 * Content-Type 为 application/json 时，只有访问 req.body 才会 JSON.parse。
 * 原始字节靠 restoreBody 回放，而且只接通 req.read 和 data/end；异步迭代看到的是已经排空的原流。
 * Next.js 的 api.bodyParser 在这个 Vite + Vercel Node 函数里不会生效。
 * 所以要在任何 req.body 访问之前读回放，不能用 JSON.stringify 重建。
 */
export async function readRequestBody(req: VercelRequest, maxBytes: number) {
  if (req.rawBody !== undefined) {
    if (Buffer.byteLength(req.rawBody) > maxBytes) throw new HttpError(413, '请求内容过大')
    if (req.body === undefined) req.body = req.rawBody || undefined
    return
  }
  const captured = await captureRawBody(req, maxBytes)
  if (captured !== undefined) {
    const text = captured.toString('utf8')
    req.rawBody = text
    req.body = text || undefined
    return
  }
  if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
    req.rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body
    req.body = req.rawBody || undefined
  }
  if (req.rawBody !== undefined && Buffer.byteLength(req.rawBody) > maxBytes) throw new HttpError(413, '请求内容过大')
}

function isReadableRequest(req: VercelRequest): req is VercelRequest & IncomingMessage {
  const stream = req as IncomingMessage
  return typeof stream.read === 'function' && typeof stream.on === 'function'
}

function toBuffer(chunk: unknown) {
  if (Buffer.isBuffer(chunk)) return chunk
  if (typeof chunk === 'string') return Buffer.from(chunk)
  return Buffer.from(chunk as Uint8Array)
}

/** 读出当前已缓冲的字节。调用方必须还没监听 data，这样回放流保持暂停，read() 才能拿到 restoreBody 写入的内容。 */
function takeBuffered(req: IncomingMessage, maxBytes: number) {
  const chunks: Buffer[] = []
  let length = 0
  for (;;) {
    const chunk: unknown = req.read()
    if (chunk == null) break
    const bytes = toBuffer(chunk)
    length += bytes.length
    if (length > maxBytes) throw new HttpError(413, '请求内容过大')
    chunks.push(bytes)
  }
  return chunks
}

function readRemaining(req: IncomingMessage, maxBytes: number, already: number) {
  return new Promise<Buffer[]>((resolve, reject) => {
    const chunks: Buffer[] = []
    let length = already
    let settled = false
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      req.removeListener('data', onData)
      req.removeListener('end', onEnd)
      req.removeListener('error', onError)
      if (error) reject(error)
      else resolve(chunks)
    }
    const onData = (chunk: unknown) => {
      const bytes = toBuffer(chunk)
      length += bytes.length
      if (length > maxBytes) {
        finish(new HttpError(413, '请求内容过大'))
        return
      }
      chunks.push(bytes)
    }
    const onEnd = () => finish()
    const onError = (error: unknown) => finish(error)
    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
  })
}

/**
 * 有原始字节时返回 Buffer（可以是空缓冲）；流已结束且没有可回放字节时返回 undefined，避免把已解析对象编造成签名体。
 */
async function captureRawBody(req: VercelRequest, maxBytes: number) {
  if (!isReadableRequest(req)) return undefined
  // 原流已被 @vercel/node 读完时 readableEnded 为 true，但 restoreBody 替换了 read()。
  // 此时再等 data/end 会挂住已经结束、且没有回放的请求。
  if (req.readableEnded) {
    const chunks = takeBuffered(req, maxBytes)
    return chunks.length ? Buffer.concat(chunks) : undefined
  }
  const buffered = takeBuffered(req, maxBytes)
  const rest = await readRemaining(req, maxBytes, buffered.reduce((sum, chunk) => sum + chunk.length, 0))
  return Buffer.concat([...buffered, ...rest])
}
