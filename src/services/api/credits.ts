import { cloudRequest } from '@/cloud/client'
import type { CreditLedgerItem } from '@shared/credits'
export type { CreditLedgerItem } from '@shared/credits'

export interface CreditLedgerPage {
  balance: number
  items: CreditLedgerItem[]
  nextCursor: string | null
}

export function listCreditLedger(cursor?: string) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
  return cloudRequest<CreditLedgerPage>(`/credits/ledger${query}`)
}
