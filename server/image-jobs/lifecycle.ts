import { HttpError } from '../errors.js'
import type { BillingPort } from './billing.js'
import type { ImageJobStore, InsertImageJobInput } from './types.js'

/** 图片和视频共用同一事务中的预扣、任务及明细创建。 */
export async function reserveAndCreateJob(
  store: ImageJobStore, billing: BillingPort, userId: string,
  input: InsertImageJobInput, meta: object,
) {
  const reserved = await billing.reserve({ userId, jobId: input.id!, amount: input.creditsReserved, meta })
  if (!reserved.ok) throw new HttpError(402, reserved.message, reserved.code, {
    extra: { required: reserved.required, balance: reserved.balance },
  })
  const job = await store.insertJob(input)
  return { job, items: await store.insertItems(job, input.requestedCount) }
}
