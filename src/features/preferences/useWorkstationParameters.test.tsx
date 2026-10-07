// @vitest-environment jsdom

import 'fake-indexeddb/auto'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultPreferences } from '@shared/preferences'
import { usePreferencesStore } from './store'
import { useWorkstationParameters } from './useWorkstationParameters'

const realClearImageMemory = usePreferencesStore.getState().clearImageMemory

describe('工作站参数记忆', () => {
  beforeEach(async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
    })))
    localStorage.clear()
    usePreferencesStore.setState({ preferences: defaultPreferences(), memoryEpoch: 0, status: 'local', error: null, ready: true })
    await usePreferencesStore.getState().initialize('workstation-tester', false)
    usePreferencesStore.getState().remember('variation', { count: 4, resolution: '4k' })
  })

  afterEach(() => {
    usePreferencesStore.setState({ clearImageMemory: realClearImageMemory })
    vi.unstubAllGlobals()
  })

  it('清除记忆后已打开的工具立刻回到个人默认值', async () => {
    const { result } = renderHook(() => useWorkstationParameters('variation'))
    expect(result.current.parameters).toMatchObject({ count: 4, resolution: '4k' })
    await act(async () => { await usePreferencesStore.getState().clearImageMemory() })
    expect(result.current.parameters).toMatchObject({ count: 2, resolution: '2k' })
  })

  it('清除失败时已打开的工具仍显示原来的记忆', async () => {
    const { result } = renderHook(() => useWorkstationParameters('variation'))
    expect(result.current.parameters).toMatchObject({ count: 4, resolution: '4k' })
    const failed = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    usePreferencesStore.setState({ clearImageMemory: failed })
    await act(async () => {
      await expect(usePreferencesStore.getState().clearImageMemory()).rejects.toThrow()
    })
    expect(result.current.parameters).toMatchObject({ count: 4, resolution: '4k' })
    expect(usePreferencesStore.getState().preferences.image.lastUsed.variation).toMatchObject({ count: 4, resolution: '4k' })
  })

  it('修改当前工具的默认张数会清掉记住的张数并立刻生效，分辨率保留', () => {
    const { result } = renderHook(() => useWorkstationParameters('variation'))
    expect(result.current.parameters).toMatchObject({ count: 4, resolution: '4k' })
    act(() => { usePreferencesStore.getState().update({ image: { counts: { variation: 1 } } }) })
    expect(result.current.parameters).toMatchObject({ count: 1, resolution: '4k' })
    expect(usePreferencesStore.getState().preferences.image.lastUsed.variation).toEqual({ resolution: '4k' })
    expect(usePreferencesStore.getState().preferences.image.counts.variation).toBe(1)
  })

  it('恢复默认张数后使用个人默认值，并保留分辨率记忆', () => {
    const { result } = renderHook(() => useWorkstationParameters('variation'))
    act(() => { usePreferencesStore.getState().update({ image: { forgetCounts: ['variation'] } }) })
    expect(result.current.parameters).toMatchObject({ count: 2, resolution: '4k' })
    expect(usePreferencesStore.getState().preferences.image.lastUsed.variation?.count).toBeUndefined()
  })

  it('修改其它工具的默认张数不会重置当前工具', () => {
    const { result } = renderHook(() => useWorkstationParameters('variation'))
    act(() => { result.current.update({ resolution: '1k' }) })
    act(() => { usePreferencesStore.getState().update({ image: { counts: { 'smart-edit': 3 } } }) })
    expect(result.current.parameters).toMatchObject({ count: 4, resolution: '1k' })
    expect(usePreferencesStore.getState().preferences.image.lastUsed['smart-edit']).toBeUndefined()
    expect(usePreferencesStore.getState().preferences.image.counts['smart-edit']).toBe(3)
  })
})
