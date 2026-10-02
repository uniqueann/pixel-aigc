// @vitest-environment jsdom

import 'fake-indexeddb/auto'
import { App } from 'antd'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ASPECT_RATIO_SETTINGS } from '@/pages/Toolbox/aspect-ratio/types'
import PersonalizationPanel from './PersonalizationPanel'
import { usePreferencesStore } from './store'
import { initialAspectRatioSettings } from './toolParameters'

function renderPanel() {
  return render(<App><PersonalizationPanel /></App>)
}

function confirmClear() {
  fireEvent.click(screen.getByRole('button', { name: '清除图片参数记忆' }))
  fireEvent.click(screen.getByRole('button', { name: '清除' }))
}

describe('清除图片参数记忆', () => {
  beforeEach(async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
    })))
    localStorage.clear()
    await usePreferencesStore.getState().initialize('panel-tester', false)
    usePreferencesStore.setState({
      preferences: {
        ...usePreferencesStore.getState().preferences,
        image: {
          ...usePreferencesStore.getState().preferences.image,
          rememberParameters: true,
          lastUsed: { 'aspect-ratio': { selectedPresetId: 'temu-main', strategy: 'letterbox' } },
        },
      },
      status: 'local',
      error: null,
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('确认后立即得到默认值并提示已清除', async () => {
    renderPanel()
    expect(initialAspectRatioSettings(usePreferencesStore.getState().preferences).selectedPresetId).toBe('temu-main')
    await act(async () => { confirmClear() })
    await waitFor(() => expect(screen.getByText('已清除图片参数记忆')).toBeTruthy())
    expect(usePreferencesStore.getState().preferences.image.lastUsed).toEqual({})
    expect(initialAspectRatioSettings(usePreferencesStore.getState().preferences)).toMatchObject({
      selectedPresetId: DEFAULT_ASPECT_RATIO_SETTINGS.selectedPresetId,
      strategy: DEFAULT_ASPECT_RATIO_SETTINGS.strategy,
    })
  })

  it('失败时提示并可重试', async () => {
    const failed = vi.fn().mockRejectedValueOnce(new Error('网络断开')).mockResolvedValueOnce(undefined)
    usePreferencesStore.setState({ clearImageMemory: failed })
    renderPanel()
    await act(async () => { confirmClear() })
    await waitFor(() => expect(screen.getByText('网络断开')).toBeTruthy())
    expect(failed).toHaveBeenCalledTimes(1)
    await act(async () => { confirmClear() })
    await waitFor(() => expect(screen.getByText('已清除图片参数记忆')).toBeTruthy())
    expect(failed).toHaveBeenCalledTimes(2)
  })
})
