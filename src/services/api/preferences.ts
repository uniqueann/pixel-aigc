import type { PreferencesPatch, PreferencesResponse } from '@shared/preferences'
import { cloudRequest } from '@/cloud/client'

export function getPreferences(owner?: string) {
  return cloudRequest<PreferencesResponse>('/preferences', 'GET', undefined, { timeoutMs: 10000, expectedUserId: owner })
}
export function savePreferences(patches: PreferencesPatch[], initializeOnly = false, owner?: string) {
  return cloudRequest<PreferencesResponse>('/preferences', 'PATCH', { patches, initializeOnly }, { timeoutMs: 10000, expectedUserId: owner })
}
export function resetPreferences(owner?: string) {
  return cloudRequest<PreferencesResponse>('/preferences/reset', 'POST', undefined, { timeoutMs: 10000, expectedUserId: owner })
}
