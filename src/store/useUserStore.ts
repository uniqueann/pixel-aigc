import { create } from 'zustand'

interface UserStoreState {
  userId: string | null
  credits: number
  tier: 'free' | 'pro' | 'enterprise'
  setCredits: (credits: number) => void
  setUser: (userId: string, tier: UserStoreState['tier']) => void
}

export const useUserStore = create<UserStoreState>((set) => ({
  userId: null,
  credits: 0,
  tier: 'free',
  setCredits: (credits) => set({ credits }),
  setUser: (userId, tier) => set({ userId, tier }),
}))
