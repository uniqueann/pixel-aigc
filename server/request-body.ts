import type { VercelRequest } from './http.js'
import { HttpError } from './errors.js'

/** 支付验签必须使用传入的原始字节；JSON 重新序列化会改变签名。 */
export async function readRequestBody(req: VercelRequest, maxBytes: number) {
  if (req.rawBody !== undefined) {
    if (Buffer.byteLength(req.rawBody)>maxBytes) throw new HttpError(413,'请求内容过大')
    if(req.body===undefined) req.body=req.rawBody || undefined
    return
  }
  if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
    req.rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body
    req.body=req.rawBody || undefined
  } else if (req.body === undefined && Symbol.asyncIterator in req) {
    const chunks: Buffer[] = []; let length=0
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      length+=bytes.length
      if (length>maxBytes) throw new HttpError(413,'请求内容过大')
      chunks.push(bytes)
    }
    req.rawBody=Buffer.concat(chunks).toString('utf8')
    req.body=req.rawBody || undefined
  }
  if (req.rawBody !== undefined && Buffer.byteLength(req.rawBody)>maxBytes) throw new HttpError(413,'请求内容过大')
}
