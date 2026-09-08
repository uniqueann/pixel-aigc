import type { IncomingMessage, ServerResponse } from 'node:http'
/** Vercel Node.js 请求响应中本应用实际使用的部分。 */
export interface VercelRequest extends IncomingMessage { body?: unknown }
export interface VercelResponse extends ServerResponse {
  status(code: number): VercelResponse
  json(body: unknown): VercelResponse
}
