import { authEnabled } from '@/cloud/client'
import { useModelSettings } from '@/features/model-settings/useModelSettings'
import type { ModelProfile } from '@/services/api/modelSettings'

const EMPTY_PROFILES: ModelProfile[] = []

export function useEmailModelConfiguration() {
  const queries = useModelSettings()
  const settings = queries.settingsQuery.data
  const profiles = queries.profilesQuery.data?.items ?? EMPTY_PROFILES
  const keyConfigured = settings ? settings.deepseek.configured && settings.deepseek.verificationStatus === 'valid' : undefined
  const error = (settings ? null : queries.settingsQuery.error) ?? (queries.profilesQuery.data ? null : queries.profilesQuery.error)
  const defaultModelProfileId = settings?.defaultEmailModelId ?? 'deepseek:deepseek-flash'
  return {
    ...queries, settings, profiles, keyConfigured, error, defaultModelProfileId,
    defaultModelLabel: profiles.find(profile => profile.id === defaultModelProfileId)?.label ?? '默认邮件模型',
    loading: authEnabled && (!settings || !queries.profilesQuery.data) && !error,
    ready: !authEnabled || Boolean(keyConfigured && queries.profilesQuery.data),
  }
}

export type EmailModelConfiguration = ReturnType<typeof useEmailModelConfiguration>
