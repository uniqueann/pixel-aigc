import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { deletePreset, listPresets, savePreset } from './presets'
import { DEFAULT_ASPECT_RATIO_SETTINGS } from './types'

describe('转比例本机模板', () => {
  it('按用户保存平台和策略，载入时丢掉未知平台', async () => {
    const saved = await savePreset('user-a', '抖音裁剪', {
      ...DEFAULT_ASPECT_RATIO_SETTINGS,
      selectedPresetId: 'tiktok-main',
      strategy: 'crop',
      fx: 0,
      fy: 1,
    })
    expect((await listPresets('user-a'))[0].settings).toMatchObject({ selectedPresetId: 'tiktok-main', strategy: 'crop', fx: 0, fy: 1 })
    expect(await listPresets('user-b')).toEqual([])
    await savePreset('user-a', '失效平台', { ...DEFAULT_ASPECT_RATIO_SETTINGS, selectedPresetId: 'gone' })
    expect((await listPresets('user-a')).find(item => item.name === '失效平台')?.settings.selectedPresetId).toBe(DEFAULT_ASPECT_RATIO_SETTINGS.selectedPresetId)
    await deletePreset(saved.id)
    expect((await listPresets('user-a')).some(item => item.id === saved.id)).toBe(false)
  })
})
