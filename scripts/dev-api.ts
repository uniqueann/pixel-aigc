import { createServer } from 'node:http'
import type { VercelRequest, VercelResponse } from '../server/http.js'
import handler from '../server/handler.js'

createServer(async (req, res) => {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 3 * 1024 * 1024) { res.writeHead(413).end(); return }
    chunks.push(chunk)
  }
  const request = req as VercelRequest
  request.body = Buffer.concat(chunks).toString() || undefined
  const response = res as VercelResponse
  response.status = (code: number) => { res.statusCode = code; return response }
  response.json = (body: unknown) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); return response }
  await handler(request, response)
}).listen(8080, '127.0.0.1', () => console.log('本地 API：http://127.0.0.1:8080'))
