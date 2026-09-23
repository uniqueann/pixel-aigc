import { cloudRequest } from '@/cloud/client'

export interface ModelProfile {
  id: string
  provider: 'deepseek'
  label: string
  capability: 'email_assist'
}

export interface ModelSettings {
  deepseek: {
    configured: boolean
    keyTail: string | null
    verificationStatus: 'valid' | 'invalid' | null
    verifiedAt: string | null
  }
  defaultEmailModelId: string
}

export function getModelProfiles() {
  return cloudRequest<{ items: ModelProfile[] }>('/model-profiles?capability=email_assist')
}

export function getModelSettings() {
  return cloudRequest<ModelSettings>('/model-settings')
}

export function saveDeepSeekKey(apiKey: string) {
  return cloudRequest<ModelSettings>('/model-settings/deepseek', 'PUT', { apiKey })
}

export function deleteDeepSeekKey() {
  return cloudRequest<ModelSettings>('/model-settings/deepseek', 'DELETE')
}

export function testDeepSeekKey() {
  return cloudRequest<ModelSettings>('/model-settings/deepseek/test', 'POST')
}

export function saveDefaultEmailModel(defaultModelProfileId: string) {
  return cloudRequest<ModelSettings>('/model-settings/email', 'PATCH', { defaultModelProfileId })
}
