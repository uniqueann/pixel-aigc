import { create } from 'zustand'

interface UserStoreState {
  userId: string | null
  account: AccountContext | null
  credits: number
  tier: 'free' | 'pro' | 'enterprise'
  setCredits: (credits: number) => void
  setUser: (userId: string, tier: UserStoreState['tier']) => void
  setAccount: (account: AccountContext | null) => void
}

export interface AccountContext {
  userId: string
  email: string
  emailVerified: boolean
  displayName: string
  avatarUrl: string | null
  providers: string[]
  status: 'active'
  workspace: { id: string; name: string; type: 'personal'; role: 'admin' }
}

export const useUserStore = create<UserStoreState>((set) => ({
  userId: null,
  account: null,
  credits: 0,
  tier: 'free',
  setCredits: (credits) => set({ credits }),
  setUser: (userId, tier) => set({ userId, tier }),
  setAccount: (account) => set({ account, userId: account?.userId ?? null }),
}))
