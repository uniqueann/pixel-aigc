// @vitest-environment jsdom

import 'fake-indexeddb/auto'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreferencesStore } from './store'
import { useWorkstationParameters } from './useWorkstationParameters'

const realClearImageMemory = usePreferencesStore.getState().clearImageMemory

describe('工作站参数记忆', () => {
  beforeEach(async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
    })))
    localStorage.clear()
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
})
