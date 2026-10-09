import { authEnabled } from '@/cloud/client'
import { useModelSettings } from '@/features/model-settings/useModelSettings'
import type { ModelProfile } from '@/services/api/modelSettings'

const EMPTY_PROFILES: ModelProfile[] = []
export function useEmailModelConfiguration() {
  const queries = useModelSettings()
  const settings = queries.settingsQuery.data
  const profiles = queries.profilesQuery.data?.items ?? EMPTY_PROFILES
  const error = (settings ? null : queries.settingsQuery.error) ?? (queries.profilesQuery.data ? null : queries.profilesQuery.error)
  const defaultModelProfileId = settings?.defaultEmailModelId ?? undefined
  return { ...queries, settings, profiles, error, defaultModelProfileId,
    loading: authEnabled && (!settings || !queries.profilesQuery.data) && !error,
    ready: !authEnabled || Boolean(settings && queries.profilesQuery.data && profiles.some(model => model.available)) }
}
export type EmailModelConfiguration = ReturnType<typeof useEmailModelConfiguration>
