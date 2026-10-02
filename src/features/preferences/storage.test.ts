import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_ASPECT_RATIO_SETTINGS } from '@/pages/Toolbox/aspect-ratio/types'
import { DEFAULT_BG_REMOVE_SETTINGS } from '@/pages/Toolbox/bg-remove/types'
import { clearLegacyImagePrefs } from './storage'
import { readPrefs as readAspectPrefs, writePrefs as writeAspectPrefs } from '@/pages/Toolbox/aspect-ratio/prefs'
import { readPrefs as readBgPrefs, writePrefs as writeBgPrefs } from '@/pages/Toolbox/bg-remove/prefs'

describe('本机旧图片偏好', () => {
  afterEach(() => localStorage.clear())

  it('清除后转比例和抠图都回到默认值', async () => {
    await writeAspectPrefs('alice', { ...DEFAULT_ASPECT_RATIO_SETTINGS, selectedPresetId: 'temu-main' })
    await writeBgPrefs('alice', { background: 'transparent' })
    await clearLegacyImagePrefs('alice')
    expect(await readAspectPrefs('alice')).toEqual(DEFAULT_ASPECT_RATIO_SETTINGS)
    expect(await readBgPrefs('alice')).toEqual(DEFAULT_BG_REMOVE_SETTINGS)
  })
})
