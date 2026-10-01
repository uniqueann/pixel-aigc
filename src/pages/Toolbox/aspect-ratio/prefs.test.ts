import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { normalizeSettings, readPrefs, writePrefs } from './prefs'
import { DEFAULT_ASPECT_RATIO_SETTINGS } from './types'

describe('转比例上次选择', () => {
  it('旧设置默认按平台尺寸，用户选择的高分辨率模式可恢复', async () => {
    expect(normalizeSettings({ strategy: 'outpaint' }).outpaintOutputMode).toBe('platform')
    await writePrefs('original-output-user', { ...DEFAULT_ASPECT_RATIO_SETTINGS, strategy: 'outpaint', outpaintOutputMode: 'original' })
    expect((await readPrefs('original-output-user')).outpaintOutputMode).toBe('original')
  })

  it('按用户记住平台和策略，未知平台回退默认', async () => {
    await writePrefs('user-a', { ...DEFAULT_ASPECT_RATIO_SETTINGS, selectedPresetId: 'tiktok-main', strategy: 'crop', fx: 0, fy: 1 })
    expect(await readPrefs('user-a')).toMatchObject({ selectedPresetId: 'tiktok-main', strategy: 'crop', fx: 0, fy: 1 })
    expect(await readPrefs('user-b')).toEqual(DEFAULT_ASPECT_RATIO_SETTINGS)
    await writePrefs('user-a', { ...DEFAULT_ASPECT_RATIO_SETTINGS, selectedPresetId: 'removed-platform' })
    expect((await readPrefs('user-a')).selectedPresetId).toBe(DEFAULT_ASPECT_RATIO_SETTINGS.selectedPresetId)
  })
})
