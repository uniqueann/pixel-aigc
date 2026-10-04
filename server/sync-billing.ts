import { createHash } from 'node:crypto'
import { z } from 'zod'
import { SYNC_PRICE_VERSION, type SyncCreditOperation, type SyncCreditQuote } from '../shared/billing.js'
import { insufficientCreditsMessage } from '../shared/credits.js'
import { withIdentity } from './db.js'
import { HttpError } from './errors.js'
import { signRead } from './storage.js'

export const syncQuoteSchema = z.object({ requestId: z.uuid(), priceVersion: z.string().max(80), maxCredits: z.number().int().min(0).max(10) }).strict()
interface BillingUser { id: string; email: string }
export interface StoredSyncResult {
  kind: 'object'; objectKey: string; bytes: number; mimeType: 'image/jpeg' | 'image/png';
  signed: { url: string; expiresAt: number }; chargedCredits?: number
}
function fingerprint(input: Record<string, unknown>) {
  // 客户端计时和报价不属于生成内容，同一请求重放不会因为上传耗时变化而冲突。
  const content=Object.fromEntries(Object.entries(input).filter(([key])=>key!=='billing' && key!=='clientTimingMs'))
  return createHash('sha256').update(JSON.stringify(content)).digest('hex')
}
async function presentSavedResult(result: Record<string, unknown>): Promise<StoredSyncResult> {
  const objectKey = String(result.objectKey)
  return { kind: 'object', objectKey, bytes: Number(result.bytes), mimeType: result.mimeType as StoredSyncResult['mimeType'],
    signed: await signRead(objectKey,900), chargedCredits: Number(result.chargedCredits ?? 0) }
}
export async function withSyncCredits(
  user: BillingUser, operation: SyncCreditOperation, quote: SyncCreditQuote, input: Record<string,unknown>,
  action: () => Promise<StoredSyncResult>,
): Promise<StoredSyncResult> {
  if (quote.priceVersion !== SYNC_PRICE_VERSION) throw new HttpError(409,'价格已更新，请重新确认报价','PRICE_CHANGED')
  const amount = operation === 'outpaint' || operation === 'bg-remove' ? quote.maxCredits : 5
  if (quote.maxCredits < amount || (operation === 'outpaint' && amount !== 5 && amount !== 10))
    throw new HttpError(409,'本次操作的积分报价不一致，请重新确认','PRICE_CHANGED')
  const job = await withIdentity(user.id,user.email,async sql => {
    await sql`select aigc.expire_sync_credits()`
    const [row] = await sql`select aigc.reserve_sync_credits(${quote.requestId},${operation},${fingerprint(input)},${quote.priceVersion},${amount}) as job`
    return row.job as Record<string,unknown>
  })
  if (job.quoteChanged) throw new HttpError(409,'本月免费抠图额度已用完，请重新确认 1 积分报价','PRICE_CHANGED')
  if (job.insufficient) throw new HttpError(402,insufficientCreditsMessage(Number(job.required),Number(job.balance)),'INSUFFICIENT_CREDITS', { extra: { required: job.required, balance: job.balance } })
  if (job.reused) {
    if (job.state === 'settled' && job.result) return presentSavedResult(job.result as Record<string,unknown>)
    if (job.state === 'refunded') throw new HttpError(409,'此操作已失败并退还积分，请主动重新提交','SYNC_REQUEST_FINISHED')
    throw new HttpError(409,'此操作仍在处理中，请查询已有结果','SYNC_REQUEST_PENDING')
  }
  try {
    const result = await action()
    const saved = { objectKey: result.objectKey, mimeType: result.mimeType, bytes: result.bytes,
      chargedCredits: Number(job.credits_reserved) === 0 ? 0 : result.chargedCredits ?? Number(job.credits_reserved) }
    const settled = await withIdentity(user.id,user.email,async sql => {
      const [row] = await sql`select aigc.finish_sync_credits(${quote.requestId},${sql.json(saved)},null) as settled`
      return row.settled
    })
    if (!settled) throw new HttpError(409,'此操作已超时并退还积分，请重新提交','SYNC_REQUEST_FINISHED')
    return result
  } catch (error) {
    try {
      await withIdentity(user.id,user.email,sql => sql`select aigc.finish_sync_credits(${quote.requestId},null,${error instanceof HttpError ? error.code : 'SERVER_ERROR'})`)
    } catch { console.error(JSON.stringify({ evt:'sync-billing', requestId:quote.requestId, code:'REFUND_DEFERRED' })) }
    throw error
  }
}
export async function getSyncCreditResult(user: BillingUser,id: string) {
  z.uuid().parse(id)
  const job = await withIdentity(user.id,user.email,async sql => {
    await sql`select aigc.expire_sync_credits()`
    const [row] = await sql`select state,result,error_code from aigc.sync_credit_jobs where id=${id}`
    if (!row) throw new HttpError(404,'操作记录不存在','SYNC_REQUEST_NOT_FOUND')
    return row
  })
  if (job.state === 'settled') {
    const result = await presentSavedResult(job.result)
    return { state:'settled', result:{ objectKey:result.objectKey,mimeType:result.mimeType,bytes:result.bytes,...result.signed } }
  }
  return { state:job.state,errorCode:job.error_code }
}
