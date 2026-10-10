import { create } from 'zustand'
import type { WelcomeState } from '@shared/activation'

interface UserStoreState {
  userId: string | null
  account: AccountContext | null
  credits: number
  /** 本次会话还没从账号或目录读到余额时为 false。未知余额不拦截生成。 */
  creditsLoaded: boolean
  tier: 'free' | 'pro' | 'enterprise'
  setCredits: (credits: number) => void
  setUser: (userId: string, tier: UserStoreState['tier']) => void
  setAccount: (account: AccountContext | null) => void
}

export interface AccountContext {
  welcome?: WelcomeState
  runtimeScope?: 'local' | 'preview' | 'production'
  userId: string
  credits: number
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
  creditsLoaded: false,
  tier: 'free',
  setCredits: (credits) => set({ credits, creditsLoaded: true }),
  setUser: (userId, tier) => set({ userId, tier, creditsLoaded: false }),
  setAccount: (account) => set({
    account,
    userId: account?.userId ?? null,
    credits: account?.credits ?? 0,
    creditsLoaded: account != null,
  }),
}))
