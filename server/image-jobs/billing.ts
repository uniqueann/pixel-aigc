import { insufficientCreditsMessage } from '../../shared/credits.js'
import type { Transaction } from '../db.js'

export interface BillingReserveInput {
  userId: string
  jobId: string
  amount: number
  meta: object
}

export interface BillingPort {
  reserve(input: BillingReserveInput): Promise<
    | { ok: true }
    | { ok: false; code: 'INSUFFICIENT_CREDITS'; message: string; required: number; balance: number }
  >
  settle(input: { jobId: string; charged: number }): Promise<void>
  release(jobId: string): Promise<void>
}

/** 单元测试和本地模拟任务使用的空实现。 */
export const noopBilling: BillingPort = {
  async reserve() {
    return { ok: true }
  },
  async settle() {},
  async release() {},
}

export async function ensureCreditAccount(sql: Transaction, userId: string) {
  const [row] = await sql`select aigc.ensure_credit_account(${userId}) as balance`
  return Number(row.balance)
}

export function createSqlBilling(sql: Transaction): BillingPort {
  async function finish(jobId: string, charged: number, kind: 'settle' | 'refund') {
    await sql`select aigc.finish_image_credits(${jobId},${charged},${kind})`
  }
  return {
    async reserve({ userId, jobId, amount, meta }) {
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('积分单价未配置')
      const [row] = await sql`select aigc.reserve_image_credits(${userId},${jobId},${amount},${sql.json(meta as never)}) as allowed`
      if (row.allowed) return { ok: true }
      const [account] = await sql`select balance from aigc.credit_accounts where user_id=${userId}`
      const balance = Number(account?.balance ?? 0)
      return {
        ok: false,
        code: 'INSUFFICIENT_CREDITS',
        message: insufficientCreditsMessage(amount, balance),
        required: amount,
        balance,
      }
    },
    settle: ({ jobId, charged }) => finish(jobId, charged, 'settle'),
    release: jobId => finish(jobId, 0, 'refund'),
  }
}
