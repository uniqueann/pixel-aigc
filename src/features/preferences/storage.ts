import { normalizePreferences, preferencesPatchSchema, type PersonalizationPreferences, type PreferencesPatch } from '@shared/preferences'

export interface PreferencesCache {
  preferences: PersonalizationPreferences
  patches: PreferencesPatch[]
  resetPending: boolean
}
function key(owner: string, kind = 'preferences') {
  return `pixel:${kind}:v1:${window.location.origin}:${owner}`
}
export function readPreferencesCache(owner: string): PreferencesCache | undefined {
  try {
    const raw = localStorage.getItem(key(owner))
    if (!raw) return
    const value = JSON.parse(raw)
    return {
      preferences: normalizePreferences(value.preferences),
      patches: Array.isArray(value.patches) ? value.patches.flatMap((patch: unknown) => {
        const parsed = preferencesPatchSchema.safeParse(patch)
        return parsed.success ? [parsed.data] : []
      }) : [],
      resetPending: value.resetPending === true,
    }
  } catch { return undefined }
}
export function writePreferencesCache(owner: string, cache: PreferencesCache): boolean {
  try { localStorage.setItem(key(owner), JSON.stringify(cache)); return true }
  catch { return false }
}
export function readSidebarState(owner: string): boolean | undefined {
  try {
    const value = localStorage.getItem(key(owner, 'sidebar'))
    return value === null ? undefined : value === 'open'
  } catch { return undefined }
}
export function writeSidebarState(owner: string, open: boolean) {
  try { localStorage.setItem(key(owner, 'sidebar'), open ? 'open' : 'collapsed') }
  catch { /* 存储受限时，当前页面仍可以展开或收起侧边栏。 */ }
}
export function clearSidebarState(owner: string) {
  try { localStorage.removeItem(key(owner, 'sidebar')) } catch { /* 存储受限时使用当前页面状态。 */ }
}

/** 仅在账号尚无云端配置时导入旧偏好，不读取图片队列或文件。 */
export async function readLegacyPreferences(owner: string): Promise<PreferencesPatch> {
  let assetsView: 'grid' | 'list' = 'grid'
  try { if (localStorage.getItem('pixel:assets-view-mode:v1') === 'list') assetsView = 'list' } catch { /* 使用默认布局。 */ }
  const [bg, aspect] = await Promise.allSettled([
    import('@/pages/Toolbox/bg-remove/prefs').then(module => module.readPrefs(owner)),
    import('@/pages/Toolbox/aspect-ratio/prefs').then(module => module.readPrefs(owner)),
  ])
  const lastUsed: NonNullable<NonNullable<PreferencesPatch['image']>['lastUsed']> = {}
  if (bg.status === 'fulfilled') lastUsed['bg-remove'] = { background: bg.value.background }
  if (aspect.status === 'fulfilled') {
    const { strategy, selectedPresetId, background, outpaintOutputMode } = aspect.value
    lastUsed['aspect-ratio'] = { strategy, selectedPresetId, background, outpaintOutputMode }
  }
  return { recent: { assetsView }, image: { lastUsed } }
}
