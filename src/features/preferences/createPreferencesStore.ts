import { create } from 'zustand'
import {
  applyPreferencesPatch, defaultPreferences, normalizePreferences, preferencesPatchSchema,
  type ImageMemory, type ImageMemoryTool, type PersonalizationPreferences, type PreferencesPatch, type PreferencesResponse,
} from '@shared/preferences'
import type { PreferencesCache } from './storage'
import { clearImageMemoryFailureMessage, preferenceUserMessage } from './errors'

interface Dependencies {
  read: (owner?: string) => Promise<PreferencesResponse>
  save: (patches: PreferencesPatch[], initializeOnly?: boolean, owner?: string) => Promise<PreferencesResponse>
  reset: (owner?: string) => Promise<PreferencesResponse>
  loadCache: (owner: string) => PreferencesCache | undefined
  saveCache: (owner: string, cache: PreferencesCache) => boolean
  legacy: (owner: string) => Promise<PreferencesPatch>
  clearLegacy: (owner: string) => Promise<void>
}
export interface PreferencesState {
  owner: string
  preferences: PersonalizationPreferences
  ready: boolean
  status: 'loading' | 'saving' | 'saved' | 'local' | 'error'
  error: string | null
  memoryEpoch: number
  initialize: (owner: string, remote: boolean) => Promise<void>
  update: (patch: PreferencesPatch) => void
  remember: <T extends ImageMemoryTool>(tool: T, value: NonNullable<ImageMemory[T]>) => void
  clearImageMemory: () => Promise<void>
  flush: () => Promise<void>
  refresh: () => Promise<void>
  retry: () => Promise<void>
  reset: () => void
}

const applyAll = (base: PersonalizationPreferences, patches: PreferencesPatch[]) => patches.reduce(applyPreferencesPatch, base)
const fullPatch = ({ workbench, image, email, recent }: PersonalizationPreferences): PreferencesPatch => ({ workbench, image, email, recent })
const isClearMemoryPatch = (patch: PreferencesPatch) => patch.image?.lastUsed === null
const hasImageMemory = (value: PersonalizationPreferences) => Object.keys(value.image.lastUsed).length > 0

export function createPreferencesStore(dependencies: Dependencies) {
  return create<PreferencesState>((set, get) => {
    let epoch = 0
    let remote = false
    let initialized = false
    let initializing: Promise<void> | undefined
    let running: Promise<void> | undefined
    let pending: PreferencesPatch[] = []
    let resetPending = false
    let flight: PreferencesPatch[] = []
    let flightReset = false
    let revision = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const cache = () => dependencies.saveCache(get().owner, {
      preferences: get().preferences,
      patches: resetPending ? pending : [...flight, ...pending],
      resetPending: resetPending || flightReset,
    })
    const localSaved = () => {
      pending = []; resetPending = false
      const saved = cache()
      set({ status: saved ? 'local' : 'error', error: saved ? null : '当前浏览器无法保存偏好，刷新后可能丢失，请检查浏览器存储设置' })
    }
    const pull = async (expectedEpoch: number) => {
      const expectedRevision = revision
      let result = await dependencies.read(get().owner)
      if (expectedEpoch !== epoch) return
      if (!result.hasStoredPreferences) {
        const cached = dependencies.loadCache(get().owner)
        const seed = cached?.preferences ?? applyPreferencesPatch(defaultPreferences(), await dependencies.legacy(get().owner))
        if (expectedEpoch !== epoch) return
        result = await dependencies.save([fullPatch(seed)], true, get().owner)
      }
      if (expectedEpoch !== epoch || expectedRevision !== revision) return
      const base = resetPending ? defaultPreferences() : normalizePreferences(result.preferences)
      const previousLastUsed = get().preferences.image.lastUsed
      set({ preferences: applyAll(base, [...flight, ...pending]), error: null, status: pending.length || resetPending ? 'saving' : 'saved' })
      if (Object.keys(previousLastUsed).length > 0 && !hasImageMemory(get().preferences)) {
        set({ memoryEpoch: get().memoryEpoch + 1 })
        void dependencies.clearLegacy(get().owner)
      }
      cache()
    }
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(() => { void get().flush() }, 300)
    }

    return {
      owner: 'local', preferences: defaultPreferences(), ready: false, status: 'loading', error: null, memoryEpoch: 0,
      initialize(owner, useRemote) {
        if (initialized && owner === get().owner && remote === useRemote) return initializing ?? Promise.resolve()
        clearTimeout(timer)
        epoch++; revision++
        const expectedEpoch = epoch
        remote = useRemote; initialized = true; running = undefined; flight = []; flightReset = false
        const cached = dependencies.loadCache(owner)
        pending = cached?.patches ?? []; resetPending = cached?.resetPending ?? false
        set({ owner, preferences: cached?.preferences ?? defaultPreferences(), ready: false, status: 'loading', error: null })
        initializing = (async () => {
          try {
            if (useRemote) await pull(expectedEpoch)
            else if (!cached) {
              const legacy = await dependencies.legacy(owner)
              if (expectedEpoch !== epoch) return
              set({ preferences: applyPreferencesPatch(defaultPreferences(), legacy) })
            }
            if (expectedEpoch !== epoch) return
            if (!useRemote) localSaved()
          } catch (error) {
            if (expectedEpoch === epoch) set({ status: 'error', error: `读取个性化设置失败，已使用本机偏好：${preferenceUserMessage(error)}` })
          } finally {
            if (expectedEpoch === epoch) {
              set({ ready: true })
              if (useRemote && (pending.length || resetPending)) schedule()
            }
          }
        })()
        return initializing
      },
      update(value) {
        const patch = preferencesPatchSchema.parse(value)
        const next = applyPreferencesPatch(get().preferences, patch)
        if (JSON.stringify(next) === JSON.stringify(get().preferences)) return
        revision++
        pending.push(patch)
        set({ preferences: next, status: remote ? 'saving' : 'local', error: null })
        if (!remote) localSaved()
        else { cache(); schedule() }
      },
      remember(tool, value) {
        if (get().preferences.image.rememberParameters) get().update({ image: { lastUsed: { [tool]: value } } })
      },
      async clearImageMemory() {
        const snapshot = structuredClone(get().preferences.image.lastUsed)
        const empty = Object.keys(snapshot).length === 0
        const epochBefore = get().memoryEpoch
        if (!empty) {
          const patch = preferencesPatchSchema.parse({ image: { lastUsed: null } })
          revision++
          pending.push(patch)
          if (!remote) {
            set({
              preferences: applyPreferencesPatch(get().preferences, patch),
              status: 'local',
              error: null,
              memoryEpoch: epochBefore + 1,
            })
            await dependencies.clearLegacy(get().owner)
            localSaved()
            return
          }
          set({ status: 'saving', error: null })
          cache()
        } else if (!remote) {
          set({ memoryEpoch: epochBefore + 1, error: null })
          await dependencies.clearLegacy(get().owner)
          localSaved()
          return
        }
        clearTimeout(timer)
        await get().flush()
        if (get().status === 'error') {
          pending = pending.filter(patch => !isClearMemoryPatch(patch))
          cache()
          throw new Error(clearImageMemoryFailureMessage(get().error))
        }
        if (get().memoryEpoch === epochBefore) set({ memoryEpoch: epochBefore + 1 })
        await dependencies.clearLegacy(get().owner)
      },
      flush() {
        clearTimeout(timer)
        if (!remote) { localSaved(); return Promise.resolve() }
        if (running) return running
        if (!pending.length && !resetPending) return Promise.resolve()
        const expectedEpoch = epoch
        running = (async () => {
          try {
            while (expectedEpoch === epoch && (pending.length || resetPending)) {
              flightReset = resetPending; resetPending = false
              flight = flightReset ? [] : pending.splice(0, 100)
              set({ status: 'saving', error: null }); cache()
              const result = flightReset ? await dependencies.reset(get().owner) : await dependencies.save(flight, false, get().owner)
              if (expectedEpoch !== epoch) return
              flight = []; flightReset = false
              const base = resetPending ? defaultPreferences() : normalizePreferences(result.preferences)
              const previousLastUsed = get().preferences.image.lastUsed
              set({ preferences: applyAll(base, pending) })
              if (Object.keys(previousLastUsed).length > 0 && !hasImageMemory(get().preferences)) {
                set({ memoryEpoch: get().memoryEpoch + 1 })
                void dependencies.clearLegacy(get().owner)
              }
              cache()
            }
            if (expectedEpoch === epoch) set({ status: 'saved', error: null })
          } catch (error) {
            if (expectedEpoch !== epoch) return
            if (!resetPending) pending = [...flight, ...pending]
            resetPending = resetPending || flightReset
            flight = []; flightReset = false
            set({ status: 'error', error: `个性化设置尚未同步：${preferenceUserMessage(error)}` }); cache()
          } finally { if (expectedEpoch === epoch) running = undefined }
        })()
        return running
      },
      async refresh() {
        if (!remote || !get().ready) return
        await get().flush()
        if (pending.length || resetPending || running) return
        const expectedEpoch = epoch
        try { await pull(expectedEpoch) }
        catch (error) { if (expectedEpoch === epoch) set({ status: 'error', error: `刷新个性化设置失败：${preferenceUserMessage(error)}` }) }
      },
      async retry() {
        if (!remote) { localSaved(); return }
        if (pending.length || resetPending || running) await get().flush()
        else await get().refresh()
      },
      reset() {
        clearTimeout(timer); revision++
        pending = []; resetPending = true
        set({ preferences: defaultPreferences(), status: remote ? 'saving' : 'local', error: null, memoryEpoch: get().memoryEpoch + 1 })
        void dependencies.clearLegacy(get().owner)
        if (!remote) localSaved()
        else { cache(); void get().flush() }
      },
    }
  })
}
