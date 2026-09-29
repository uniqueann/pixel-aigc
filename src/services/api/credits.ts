import { cloudRequest } from '@/cloud/client'

export interface CreditLedgerItem {
  id: string
  createdAt: string
  kind: string
  label: string
  title: string
  summary: string
  delta: number
  deltaText: string
  balanceAfter: number
  charged: number | null
  reason: string | null
}

export interface CreditLedgerPage {
  balance: number
  items: CreditLedgerItem[]
  nextCursor: string | null
}

export function listCreditLedger(cursor?: string) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
  return cloudRequest<CreditLedgerPage>(`/credits/ledger${query}`)
}
