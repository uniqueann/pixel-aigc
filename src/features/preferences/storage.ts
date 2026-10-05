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

/** 与收起态图标栏一致，不能再窄。 */
export const SIDEBAR_WIDTH_MIN = 68
/** 当前展开宽度，不能拖得更宽。 */
export const SIDEBAR_WIDTH_MAX = 260
/** 窄于该宽度时隐藏文字，只留图标。 */
export const SIDEBAR_WIDTH_COMPACT = 168

export function clampSidebarWidth(width: number) {
  if (!Number.isFinite(width)) return SIDEBAR_WIDTH_MAX
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(width)))
}
export function readSidebarWidth(owner: string): number | undefined {
  try {
    const raw = localStorage.getItem(key(owner, 'sidebar-width'))
    if (raw === null) return
    const value = Number(raw)
    return Number.isFinite(value) ? clampSidebarWidth(value) : undefined
  } catch { return undefined }
}
export function writeSidebarWidth(owner: string, width: number) {
  try { localStorage.setItem(key(owner, 'sidebar-width'), String(clampSidebarWidth(width))) }
  catch { /* 存储受限时，当前页面仍可拖拽调整宽度。 */ }
}
export function clearSidebarState(owner: string) {
  try {
    localStorage.removeItem(key(owner, 'sidebar'))
    localStorage.removeItem(key(owner, 'sidebar-width'))
  } catch { /* 存储受限时使用当前页面状态。 */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('pixel-sidebar-reset', { detail: owner }))
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

/** 清除工具箱本机旧偏好，避免清空云端记忆后再次被 IndexedDB 回填。 */
export async function clearLegacyImagePrefs(owner: string): Promise<void> {
  const [{ DEFAULT_BG_REMOVE_SETTINGS }, session] = await Promise.all([
    import('@/pages/Toolbox/bg-remove/types'),
    import('@/pages/Toolbox/bg-remove/session'),
  ])
  const current = session.loadBgRemoveSession(owner)
  if (current) session.saveBgRemoveSession({ ...current, settings: DEFAULT_BG_REMOVE_SETTINGS })
  await Promise.allSettled([
    import('@/pages/Toolbox/bg-remove/prefs').then(module => module.clearPrefs(owner)),
    import('@/pages/Toolbox/aspect-ratio/prefs').then(module => module.clearPrefs(owner)),
  ])
}
