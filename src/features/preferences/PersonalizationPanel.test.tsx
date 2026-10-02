// @vitest-environment jsdom

import 'fake-indexeddb/auto'
import { useState, type ReactNode } from 'react'
import { App } from 'antd'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ASPECT_RATIO_SETTINGS } from '@/pages/Toolbox/aspect-ratio/types'

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>()
  return {
    ...actual,
    Popconfirm: ({ title, onConfirm, children }: { title?: ReactNode; onConfirm?: () => void | Promise<void>; children: ReactNode }) => (
      <div>
        {children}
        {String(title).includes('清除图片参数记忆') ? <button type="button" onClick={() => void onConfirm?.()}>确认清除</button> : null}
      </div>
    ),
  }
})

import PersonalizationPanel from './PersonalizationPanel'
import { usePreferencesStore } from './store'
import { initialAspectRatioSettings } from './toolParameters'
import { CLEAR_IMAGE_MEMORY_SUCCESS_DURATION } from './errors'

const realClearImageMemory = usePreferencesStore.getState().clearImageMemory

function renderPanel() {
  return render(<App><PersonalizationPanel /></App>)
}

function buttonByText(name: string) {
  const button = screen.getByText(name).closest('button')
  if (!button) throw new Error(`未找到「${name}」按钮`)
  return button
}

describe('清除图片参数记忆', () => {
  beforeEach(async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
    })))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
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
    usePreferencesStore.setState({ clearImageMemory: realClearImageMemory, error: null })
    vi.mocked(console.error).mockRestore()
    cleanup()
    vi.unstubAllGlobals()
  })

  it('确认后立即得到默认值并提示已清除', async () => {
    renderPanel()
    expect(initialAspectRatioSettings(usePreferencesStore.getState().preferences).selectedPresetId).toBe('temu-main')
    await act(async () => { fireEvent.click(buttonByText('确认清除')) })
    await waitFor(() => expect(screen.getByText('已清除图片参数记忆')).toBeTruthy())
    expect(usePreferencesStore.getState().preferences.image.lastUsed).toEqual({})
    expect(initialAspectRatioSettings(usePreferencesStore.getState().preferences)).toMatchObject({
      selectedPresetId: DEFAULT_ASPECT_RATIO_SETTINGS.selectedPresetId,
      strategy: DEFAULT_ASPECT_RATIO_SETTINGS.strategy,
    })
  })

  it('PATCH 失败时回滚记忆、显示中文提示和就地重试，重试成功后才清除', async () => {
    const temu = { selectedPresetId: 'temu-main' as const, strategy: 'letterbox' as const }
    const clear = vi.fn(async () => {
      if (clear.mock.calls.length === 1) throw new TypeError('Failed to fetch')
      usePreferencesStore.setState(state => ({
        preferences: {
          ...state.preferences,
          image: { ...state.preferences.image, lastUsed: {} },
        },
        memoryEpoch: state.memoryEpoch + 1,
        error: null,
        status: 'saved',
      }))
    })
    usePreferencesStore.setState({
      clearImageMemory: clear,
      error: null,
      status: 'saved',
    })
    render(
      <App>
        <PersonalizationPanel />
        <AspectRatioReadout />
      </App>,
    )
    expect(screen.getByText('当前预设 temu-main')).toBeTruthy()
    expect(initialAspectRatioSettings(usePreferencesStore.getState().preferences).selectedPresetId).toBe('temu-main')
    await act(async () => { fireEvent.click(buttonByText('确认清除')) })
    await waitFor(() => expect(document.querySelector('.preferences-clear-error')?.textContent).toBe('清除失败，网络异常，请检查网络后重试'))
    expect(screen.queryByText('Failed to fetch')).toBeNull()
    const retry = document.querySelector('.preferences-clear-retry')
    if (!(retry instanceof HTMLButtonElement)) throw new Error('未找到就地重试按钮')
    expect(retry.textContent).toBe('重试')
    expect(screen.getByText('当前预设 temu-main')).toBeTruthy()
    expect(usePreferencesStore.getState().preferences.image.lastUsed).toEqual({ 'aspect-ratio': temu })
    expect(clear).toHaveBeenCalledTimes(1)
    await act(async () => { fireEvent.click(retry) })
    await waitFor(() => expect(screen.getByText('已清除图片参数记忆')).toBeTruthy())
    expect(clear).toHaveBeenCalledTimes(2)
    expect(usePreferencesStore.getState().preferences.image.lastUsed).toEqual({})
    expect(screen.getByText(`当前预设 ${DEFAULT_ASPECT_RATIO_SETTINGS.selectedPresetId}`)).toBeTruthy()
    expect(CLEAR_IMAGE_MEMORY_SUCCESS_DURATION).toBe(3)
  })
})

function AspectRatioReadout() {
  const memoryEpoch = usePreferencesStore(state => state.memoryEpoch)
  const [applied, setApplied] = useState(memoryEpoch)
  const [preset, setPreset] = useState(() => initialAspectRatioSettings(usePreferencesStore.getState().preferences).selectedPresetId)
  if (applied !== memoryEpoch) {
    setPreset(initialAspectRatioSettings(usePreferencesStore.getState().preferences).selectedPresetId)
    setApplied(memoryEpoch)
  }
  return <div>当前预设 {preset}</div>
}
