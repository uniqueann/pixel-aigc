import { cloudRequest } from '@/cloud/client'
import type { EmailModelId } from '@shared/email-models'

export interface ModelProfile {
  id: EmailModelId
  provider: 'deepseek' | 'ai-gateway'
  label: string
  capability: 'email_assist'
  credits: number
  priceVersion: string
  available: boolean
  unavailableReason: string | null
}
export interface ModelSettings { defaultEmailModelId: EmailModelId | null }
export function getModelProfiles() {
  return cloudRequest<{ items: ModelProfile[] }>('/model-profiles?capability=email_assist')
}
export function getModelSettings() { return cloudRequest<ModelSettings>('/model-settings') }
export function saveDefaultEmailModel(defaultModelProfileId: EmailModelId | null) {
  return cloudRequest<ModelSettings>('/model-settings/email', 'PATCH', { defaultModelProfileId })
}
