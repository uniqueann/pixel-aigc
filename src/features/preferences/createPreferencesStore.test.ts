import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyPreferencesPatch, defaultPreferences, type PreferencesResponse } from '@shared/preferences'
import { initialAspectRatioSettings } from './toolParameters'
import { createPreferencesStore } from './createPreferencesStore'
import type { PreferencesCache } from './storage'
import { DEFAULT_ASPECT_RATIO_SETTINGS } from '@/pages/Toolbox/aspect-ratio/types'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
function fixture() {
  let server = defaultPreferences(), stored = true
  const response = (): PreferencesResponse => ({ preferences: structuredClone(server), hasStoredPreferences: stored, updatedAt: null })
  const caches = new Map<string, PreferencesCache>()
  const dependencies = {
    read: vi.fn(async () => response()),
    save: vi.fn(async (patches: Parameters<typeof applyPreferencesPatch>[1][], initializeOnly?: boolean) => {
      if (!initializeOnly || !stored) { server = patches.reduce(applyPreferencesPatch, server); stored = true }
      return response()
    }),
    reset: vi.fn(async () => { server = defaultPreferences(); return response() }),
    loadCache: (owner: string) => caches.get(owner),
    saveCache: vi.fn((owner: string, cache: PreferencesCache) => { caches.set(owner, structuredClone(cache)); return true }),
    legacy: vi.fn(async () => ({ recent: { assetsView: 'list' as const } })),
    clearLegacy: vi.fn(async () => undefined),
  }
  return { dependencies, caches, response, server: () => server, empty: () => { stored = false }, store: createPreferencesStore(dependencies) }
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.mocked(console.error).mockRestore()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('个性化同步与恢复', () => {
  it('两台设备分别修改字段，刷新后得到合并结果', async () => {
    const f = fixture(), second = createPreferencesStore(f.dependencies)
    await f.store.getState().initialize('alice', true); await second.getState().initialize('alice', true)
    f.store.getState().update({ email: { language: 'en' } })
    second.getState().update({ image: { counts: { variation: 4 } } })
    await f.store.getState().flush(); await second.getState().flush(); await f.store.getState().refresh()
    expect(f.store.getState().preferences.email.language).toBe('en')
    expect(f.store.getState().preferences.image.counts.variation).toBe(4)
    expect(second.getState().preferences.email.language).toBe('en')
  })
  it('同字段采用最后提交值，连续修改合并为一个请求', async () => {
    const f = fixture(); await f.store.getState().initialize('alice', true)
    f.store.getState().update({ email: { language: 'en' } }); f.store.getState().update({ email: { language: 'ja' } })
    await vi.advanceTimersByTimeAsync(300)
    expect(f.dependencies.save).toHaveBeenCalledTimes(1)
    expect(f.server().email.language).toBe('ja')
  })
  it('首次读取结束后才标记就绪，避免默认值闪现', async () => {
    const f = fixture(), read = deferred<PreferencesResponse>(); f.dependencies.read.mockReturnValueOnce(read.promise)
    const initialized = f.store.getState().initialize('alice', true)
    expect(f.store.getState().ready).toBe(false)
    const value = f.response(); value.preferences.email.language = 'ja'; read.resolve(value); await initialized
    expect(f.store.getState().ready).toBe(true)
    expect(f.store.getState().preferences.email.language).toBe('ja')
  })
  it('保存中再次修改时旧响应不会覆盖新值', async () => {
    const f = fixture(); await f.store.getState().initialize('alice', true)
    const first = deferred<PreferencesResponse>(); f.dependencies.save.mockReturnValueOnce(first.promise)
    f.store.getState().update({ email: { language: 'en' } }); const saving = f.store.getState().flush()
    f.store.getState().update({ email: { language: 'ja' } })
    first.resolve({ ...f.response(), preferences: applyPreferencesPatch(defaultPreferences(), { email: { language: 'en' } }) }); await saving
    expect(f.store.getState().preferences.email.language).toBe('ja')
    expect(f.store.getState().status).toBe('saved')
  })
  it('失败保留修改，重新打开后可重试同步', async () => {
    const f = fixture(); await f.store.getState().initialize('alice', true)
    f.dependencies.save.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    f.store.getState().update({ email: { language: 'ja' } }); await f.store.getState().flush()
    expect(f.store.getState().status).toBe('error')
    expect(f.store.getState().error).toBe('个性化设置尚未同步：网络异常，请检查网络后重试')
    expect(f.store.getState().preferences.email.language).toBe('ja')
    expect(f.caches.get('alice')?.patches).toHaveLength(1)
    const restarted = createPreferencesStore(f.dependencies); await restarted.getState().initialize('alice', true)
    expect(restarted.getState().preferences.email.language).toBe('ja')
    await restarted.getState().retry()
    expect(f.server().email.language).toBe('ja'); expect(f.caches.get('alice')?.patches).toEqual([])
  })
  it('切换账号后忽略旧账号的迟到响应', async () => {
    const f = fixture(), old = deferred<PreferencesResponse>(); f.dependencies.read.mockReturnValueOnce(old.promise)
    const alice = f.store.getState().initialize('alice', true); await f.store.getState().initialize('bob', true)
    const value = f.response(); value.preferences.email.language = 'ja'; old.resolve(value); await alice
    expect(f.store.getState().owner).toBe('bob'); expect(f.store.getState().preferences.email.language).toBe('zh')
    expect(f.caches.has('alice')).toBe(false)
  })
  it('旧账号保存响应不会写入新账号缓存', async () => {
    const f = fixture(); await f.store.getState().initialize('alice', true)
    const save = deferred<PreferencesResponse>(); f.dependencies.save.mockReturnValueOnce(save.promise)
    f.store.getState().update({ email: { language: 'ja' } }); const saving = f.store.getState().flush()
    await f.store.getState().initialize('bob', true)
    const old = f.response(); old.preferences.email.language = 'ja'; save.resolve(old); await saving
    expect(f.store.getState().owner).toBe('bob')
    expect(f.store.getState().preferences.email.language).toBe('zh')
    expect(f.caches.get('bob')?.preferences.email.language).toBe('zh')
    expect(f.caches.get('alice')?.patches).toHaveLength(1)
  })
  it('刷新期间的新修改不被云端旧值覆盖', async () => {
    const f = fixture(); await f.store.getState().initialize('alice', true)
    const read = deferred<PreferencesResponse>(); f.dependencies.read.mockReturnValueOnce(read.promise)
    const refreshing = f.store.getState().refresh(); await Promise.resolve()
    f.store.getState().update({ email: { language: 'ja' } })
    read.resolve(f.response()); await refreshing
    expect(f.store.getState().preferences.email.language).toBe('ja')
    await f.store.getState().flush()
    expect(f.server().email.language).toBe('ja')
  })
  it('关闭图片记忆暂停写入，保留此前记忆', async () => {
    const f = fixture(); await f.store.getState().initialize('alice', false)
    f.store.getState().remember('variation', { count: 4 }); f.store.getState().update({ image: { rememberParameters: false } })
    f.store.getState().remember('variation', { count: 1 })
    expect(f.store.getState().preferences.image.lastUsed.variation?.count).toBe(4)
    expect(f.dependencies.save).not.toHaveBeenCalled()
  })
  it('清除记忆与后续修改按顺序提交', async () => {
    const f = fixture(); await f.store.getState().initialize('alice', true)
    f.store.getState().remember('variation', { count: 4 }); await f.store.getState().flush()
    f.store.getState().update({ image: { lastUsed: null } }); f.store.getState().remember('relight', { count: 3 })
    await f.store.getState().flush()
    expect(f.server().image.lastUsed).toEqual({ relight: { count: 3 } })
  })
  it('旧保存之后恢复默认，恢复期间的新操作仍被保留', async () => {
    const f = fixture(); await f.store.getState().initialize('alice', true)
    const first = deferred<PreferencesResponse>(); f.dependencies.save.mockReturnValueOnce(first.promise)
    f.store.getState().update({ email: { language: 'en' } }); const saving = f.store.getState().flush()
    f.store.getState().reset(); f.store.getState().update({ workbench: { assetsView: 'list' } })
    first.resolve(f.response()); await saving
    expect(f.dependencies.reset).toHaveBeenCalledOnce(); expect(f.server().email.language).toBe('zh')
    expect(f.server().workbench.assetsView).toBe('list'); expect(f.server().image.lastUsed).toEqual({})
  })
  it('云端尚无配置时才导入旧偏好', async () => {
    const f = fixture(); f.empty(); await f.store.getState().initialize('alice', true)
    expect(f.dependencies.save).toHaveBeenCalledWith(expect.any(Array), true, 'alice')
    expect(f.store.getState().preferences.recent.assetsView).toBe('list')
    const second = createPreferencesStore(f.dependencies); await second.getState().initialize('bob', true)
    expect(f.dependencies.legacy).toHaveBeenCalledTimes(1)
  })
  it('读取失败使用本账号缓存，不借用另一账号配置', async () => {
    const f = fixture()
    f.caches.set('alice', { preferences: applyPreferencesPatch(defaultPreferences(), { email: { language: 'en' } }), patches: [], resetPending: false })
    f.dependencies.read.mockRejectedValue(new Error('网络断开')); await f.store.getState().initialize('alice', true)
    expect(f.store.getState().preferences.email.language).toBe('en'); expect(f.store.getState().ready).toBe(true)
    await f.store.getState().initialize('bob', true); expect(f.store.getState().preferences.email.language).toBe('zh')
  })
  it('清除记忆立即提交且不受防抖影响，迟到读取不会回填', async () => {
    const f = fixture(); await f.store.getState().initialize('alice', true)
    const remembered = { selectedPresetId: 'temu-main', strategy: 'letterbox' as const }
    f.store.getState().remember('aspect-ratio', remembered)
    await f.store.getState().flush()
    const read = deferred<PreferencesResponse>(); f.dependencies.read.mockReturnValueOnce(read.promise)
    const refreshing = f.store.getState().refresh(); await Promise.resolve()
    const saveGate = deferred<void>()
    const saveImpl = f.dependencies.save.getMockImplementation()!
    f.dependencies.save.mockImplementationOnce(async (patches: Parameters<typeof applyPreferencesPatch>[1][], initializeOnly?: boolean) => {
      await saveGate.promise
      return saveImpl(patches, initializeOnly)
    })
    const clearing = f.store.getState().clearImageMemory()
    await Promise.resolve()
    expect(f.dependencies.save).toHaveBeenCalledTimes(2)
    expect(f.dependencies.clearLegacy).not.toHaveBeenCalled()
    expect(f.store.getState().preferences.image.lastUsed).toEqual({ 'aspect-ratio': remembered })
    const stale = f.response()
    stale.preferences = applyPreferencesPatch(defaultPreferences(), { image: { lastUsed: { 'aspect-ratio': remembered } } })
    read.resolve(stale)
    await refreshing
    expect(f.store.getState().preferences.image.lastUsed).toEqual({ 'aspect-ratio': remembered })
    saveGate.resolve()
    await clearing
    expect(f.store.getState().preferences.image.lastUsed).toEqual({})
    expect(f.server().image.lastUsed).toEqual({})
    expect(f.dependencies.clearLegacy).toHaveBeenCalledWith('alice')
    expect(initialAspectRatioSettings(f.store.getState().preferences).selectedPresetId).toBe(DEFAULT_ASPECT_RATIO_SETTINGS.selectedPresetId)
    expect(f.store.getState().memoryEpoch).toBeGreaterThan(0)
  })
  it('PATCH 失败时回滚本地状态，工具页仍显示原记忆，重试成功后才清除', async () => {
    const f = fixture(); await f.store.getState().initialize('alice', true)
    const remembered = { selectedPresetId: 'temu-main', strategy: 'letterbox' as const }
    f.store.getState().remember('aspect-ratio', remembered)
    await f.store.getState().flush()
    const epoch = f.store.getState().memoryEpoch
    f.dependencies.save.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(f.store.getState().clearImageMemory()).rejects.toThrow('清除失败，网络异常，请检查网络后重试')
    expect(f.store.getState().status).toBe('error')
    expect(f.store.getState().error).toMatch(/网络异常/)
    expect(f.store.getState().error).not.toMatch(/Failed to fetch/)
    expect(f.store.getState().preferences.image.lastUsed).toEqual({ 'aspect-ratio': remembered })
    expect(f.caches.get('alice')?.preferences.image.lastUsed).toEqual({ 'aspect-ratio': remembered })
    expect(f.caches.get('alice')?.patches.some(patch => patch.image?.lastUsed === null)).toBe(false)
    expect(f.store.getState().memoryEpoch).toBe(epoch)
    expect(f.dependencies.clearLegacy).not.toHaveBeenCalled()
    expect(initialAspectRatioSettings(f.store.getState().preferences).selectedPresetId).toBe('temu-main')
    expect(f.server().image.lastUsed).toEqual({ 'aspect-ratio': remembered })
    await f.store.getState().clearImageMemory()
    expect(f.server().image.lastUsed).toEqual({})
    expect(f.store.getState().preferences.image.lastUsed).toEqual({})
    expect(f.store.getState().status).toBe('saved')
    expect(f.store.getState().memoryEpoch).toBeGreaterThan(epoch)
    expect(f.dependencies.clearLegacy).toHaveBeenCalledWith('alice')
    expect(initialAspectRatioSettings(f.store.getState().preferences).selectedPresetId).toBe(DEFAULT_ASPECT_RATIO_SETTINGS.selectedPresetId)
  })
  it('修改默认张数会清掉该工具记住的张数，其它工具和分辨率仍保留', async () => {
    const f = fixture(); await f.store.getState().initialize('alice', true)
    f.store.getState().remember('smart-edit', { count: 3, resolution: '4k' })
    f.store.getState().remember('variation', { count: 4 })
    await f.store.getState().flush()
    f.store.getState().update({ image: { counts: { 'smart-edit': 2 } } })
    await f.store.getState().flush()
    expect(f.server().image.counts['smart-edit']).toBe(2)
    expect(f.server().image.lastUsed['smart-edit']).toEqual({ resolution: '4k' })
    expect(f.server().image.lastUsed.variation).toEqual({ count: 4 })
    expect(f.store.getState().preferences.image.lastUsed['smart-edit']?.count).toBeUndefined()
  })
})
