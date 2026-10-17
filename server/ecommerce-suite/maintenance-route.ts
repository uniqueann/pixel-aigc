import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { runtimeScope } from '../db.js'
import { HttpError } from '../errors.js'
import { ecommerceSuiteEnabled } from './config.js'

/** 内部维护不接受浏览器账号，也不允许请求切换运行环境。 */
export function authorizeSuiteMaintenance(authorization: string | undefined, body: unknown) {
  const secret = process.env.IMAGE_CRON_SECRET
  const supplied = authorization?.replace(/^Bearer /, '') ?? ''
  if (!secret || Buffer.byteLength(supplied) !== Buffer.byteLength(secret) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(secret)))
    throw new HttpError(401, '未授权', 'AUTH_REQUIRED')
  const input = z.object({ scope: z.enum(['local', 'preview', 'production']) }).strict().parse(body)
  if (input.scope !== runtimeScope()) throw new HttpError(400, '套图维护环境不匹配', 'INVALID_SCOPE')
  if (!ecommerceSuiteEnabled() || process.env.ECOMMERCE_SUITE_MAINTENANCE_ENABLED !== 'true')
    throw new HttpError(503, '套图维护尚未启用', 'MAINTENANCE_DISABLED')
}
