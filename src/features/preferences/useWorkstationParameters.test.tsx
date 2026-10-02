// @vitest-environment jsdom

import 'fake-indexeddb/auto'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreferencesStore } from './store'
import { useWorkstationParameters } from './useWorkstationParameters'

describe('工作站参数记忆', () => {
  beforeEach(async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
    })))
    localStorage.clear()
    await usePreferencesStore.getState().initialize('workstation-tester', false)
    usePreferencesStore.getState().remember('variation', { count: 4, resolution: '4k' })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('清除记忆后已打开的工具立刻回到个人默认值', async () => {
    const { result } = renderHook(() => useWorkstationParameters('variation'))
    expect(result.current.parameters).toMatchObject({ count: 4, resolution: '4k' })
    await act(async () => { await usePreferencesStore.getState().clearImageMemory() })
    expect(result.current.parameters).toMatchObject({ count: 2, resolution: '2k' })
  })
})
