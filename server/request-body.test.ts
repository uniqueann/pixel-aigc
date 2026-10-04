import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { readRequestBody } from './request-body'
import type { VercelRequest } from './http'

describe('原始请求体',()=>{
  it('保留流中中文、空格和换行，用于支付签名',async()=>{
    const body='{ "title": "充值" }\n',req=Readable.from([Buffer.from(body)]) as VercelRequest
    await readRequestBody(req,1024)
    expect(req.rawBody).toBe(body);expect(req.body).toBe(body)
  })
  it('Buffer请求体转换为原始文本供普通JSON路由解析',async()=>{
    const req={body:Buffer.from('{"amount":199}')} as VercelRequest
    await readRequestBody(req,1024);expect(req.body).toBe('{"amount":199}')
  })
  it('超过大小限制的流立即拒绝，已解析对象不伪造原始签名体',async()=>{
    const req=Readable.from([Buffer.alloc(2048)]) as VercelRequest
    await expect(readRequestBody(req,1024)).rejects.toMatchObject({status:413})
    const parsed={body:{amount:199}} as VercelRequest
    await readRequestBody(parsed,1024);expect(parsed.rawBody).toBeUndefined()
  })
})
