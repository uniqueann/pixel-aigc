import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { readPrefs, writePrefs } from './prefs'
import { DEFAULT_ASPECT_RATIO_SETTINGS } from './types'

describe('转比例上次选择', () => {
  it('按用户记住平台和策略，未知平台回退默认', async () => {
    await writePrefs('user-a', { ...DEFAULT_ASPECT_RATIO_SETTINGS, selectedPresetId: 'tiktok-main', strategy: 'crop', fx: 0, fy: 1 })
    expect(await readPrefs('user-a')).toMatchObject({ selectedPresetId: 'tiktok-main', strategy: 'crop', fx: 0, fy: 1 })
    expect(await readPrefs('user-b')).toEqual(DEFAULT_ASPECT_RATIO_SETTINGS)
    await writePrefs('user-a', { ...DEFAULT_ASPECT_RATIO_SETTINGS, selectedPresetId: 'removed-platform' })
    expect((await readPrefs('user-a')).selectedPresetId).toBe(DEFAULT_ASPECT_RATIO_SETTINGS.selectedPresetId)
  })
})
