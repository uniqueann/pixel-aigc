export interface BillingReserveInput {
  userId: string
  jobId: string
  amount: number
  meta: object
}

export interface BillingPort {
  reserve(input: BillingReserveInput): Promise<{ ok: true } | { ok: false; code: 'INSUFFICIENT_CREDITS'; message: string }>
  settle(input: { jobId: string; charged: number }): Promise<void>
  release(jobId: string): Promise<void>
}

/** 第一期不计费，只保留预扣 / 结算 / 退还调用点。 */
export const noopBilling: BillingPort = {
  async reserve() {
    return { ok: true }
  },
  async settle() {},
  async release() {},
}
