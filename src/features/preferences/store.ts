import { getPreferences, resetPreferences, savePreferences } from '@/services/api/preferences'
import { createPreferencesStore } from './createPreferencesStore'
import { readLegacyPreferences, readPreferencesCache, writePreferencesCache } from './storage'

export const usePreferencesStore = createPreferencesStore({
  read: getPreferences, save: savePreferences, reset: resetPreferences,
  loadCache: readPreferencesCache, saveCache: writePreferencesCache, legacy: readLegacyPreferences,
})
