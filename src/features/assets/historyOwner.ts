import { authEnabled } from '@/cloud/client'
import { useUserStore } from '@/store/useUserStore'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function resolveWorkstationHistoryOwner(requiresAuth: boolean, userId: string | null): string {
  if (!requiresAuth) return 'anonymous'
  if (!userId || !UUID.test(userId)) throw new Error('登录账号尚未就绪，无法读取本地历史')
  return userId
}

export function currentWorkstationHistoryOwner(): string {
  return resolveWorkstationHistoryOwner(authEnabled, useUserStore.getState().userId)
}

export function isCurrentWorkstationHistoryOwner(ownerId: string): boolean {
  try {
    return currentWorkstationHistoryOwner() === ownerId
  } catch {
    return false
  }
}
